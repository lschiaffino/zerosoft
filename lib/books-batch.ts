/**
 * Books: cobros y pagos por lote. Varias facturas (o facturas de proveedor) de
 * la misma moneda se saldan con un solo movimiento de banco: un asiento, una
 * línea de banco por el total y una por documento contra deudores o
 * proveedores. Todo o nada, dentro de una transacción. Server-only.
 */
import { getDb } from './db';
import { assertCan, audit, ensureBooks } from './books';
import { amountDue, clearedBase, getDocRow, settleBase, statusFor, type DocRow } from './books-docs';
import { inTransaction, keyAccounts, postJournal, reverseJournal, type JournalLineInput } from './books-ledger';
import { BooksError, clean, newId, nowDb, type BooksActor } from './books-schema';
import { convert, isValidDate, normalizeRate, parseAmount, todayIso } from './books-money';

export const MAX_BATCH_DOCS = 200;

export interface BatchInput {
  docType: 'invoice' | 'bill';
  date?: string;
  bankAccountId: string;
  reference?: string;
  fxRate?: string | number;
  allocations: Array<{ docId: string; amount: number | string }>;
}

export interface BatchDto {
  id: string;
  docType: 'invoice' | 'bill';
  date: string;
  currency: string;
  reference: string;
  total: number;
  journalId: string | null;
  bankTxnId: string | null;
  accountName: string;
  count: number;
  createdAt: string;
}

const permFor = (t: 'invoice' | 'bill') => (t === 'bill' ? 'bills.write' : 'invoices.write') as 'bills.write' | 'invoices.write';

export async function recordBatchPayment(actor: BooksActor, input: BatchInput): Promise<BatchDto> {
  const docType = input.docType === 'bill' ? 'bill' : 'invoice';
  assertCan(actor, permFor(docType));
  const s = await ensureBooks(actor.ws);
  const date = input.date ?? todayIso();
  if (!isValidDate(date)) throw new BooksError('invalid_date');
  if (!Array.isArray(input.allocations) || !input.allocations.length) throw new BooksError('nothing_selected');
  if (input.allocations.length > MAX_BATCH_DOCS) throw new BooksError('too_many_lines');
  if (new Set(input.allocations.map((a) => a.docId)).size !== input.allocations.length) throw new BooksError('invalid_input');
  const bank = (await getDb().prepare('SELECT account_id FROM books_bank_accounts WHERE id = ? AND workspace_id = ? AND archived = 0').get(input.bankAccountId, actor.ws)) as { account_id: string } | undefined;
  if (!bank) throw new BooksError('invalid_account');
  const k = await keyAccounts(actor.ws, ['ar', 'ap', 'fx'] as const);
  const id = newId('bat');
  const ts = nowDb();
  const paid: DocRow[] = [];
  await inTransaction(async (db) => {
    let currency: string | null = null;
    let payFx = '1';
    let total = 0;
    let totalAtDoc = 0;
    const lines: JournalLineInput[] = [];
    const pays: Array<{ d: DocRow; amount: number; atDoc: number }> = [];
    for (const a of input.allocations) {
      const d = await getDocRow(actor.ws, a.docId, db);
      if (!d || d.doc_type !== docType) throw new BooksError('not_found', 404);
      if (!['sent', 'partial', 'overdue'].includes(d.status)) throw new BooksError('invalid_status', 409, { status: d.status });
      if (currency && currency !== d.currency) throw new BooksError('currency_mismatch', 409);
      if (!currency) {
        currency = d.currency;
        payFx = currency === s.base_currency ? '1' : (normalizeRate(input.fxRate) ?? d.fx_rate);
      }
      const amount = typeof a.amount === 'number' ? Math.trunc(a.amount) : parseAmount(a.amount, d.currency);
      if (amount == null || amount <= 0) throw new BooksError('invalid_amount');
      if (amount > amountDue(d)) throw new BooksError('amount_exceeds_due', 409, { due: amountDue(d), docId: d.id });
      const atDoc = settleBase(d, s.base_currency, d.paid_total + d.credited_total, amount, await clearedBase(db, d, s.base_currency));
      total += amount;
      totalAtDoc += atDoc;
      pays.push({ d, amount, atDoc });
      lines.push(docType === 'bill' ? { accountId: k.ap, debit: atDoc, contactId: d.contact_id, description: d.number_label } : { accountId: k.ar, credit: atDoc, contactId: d.contact_id, description: d.number_label });
    }
    const totalAtPay = convert(total, currency!, payFx, s.base_currency);
    lines.push(docType === 'bill' ? { accountId: bank.account_id, credit: totalAtPay } : { accountId: bank.account_id, debit: totalAtPay });
    const diff = totalAtPay - totalAtDoc;
    if (diff !== 0) {
      // Cobrar más (en base) que lo registrado es ganancia de cambio; pagar más es pérdida.
      const gain = docType === 'bill' ? -diff : diff;
      lines.push(gain > 0 ? { accountId: k.fx, credit: gain, description: 'FX' } : { accountId: k.fx, debit: -gain, description: 'FX' });
    }
    const reference = clean(input.reference ?? '', 120);
    const journalId = await postJournal(actor.ws, actor.person, { date, memo: reference || `Batch ${pays.length}`, sourceType: 'batch', sourceId: id, lines }, { db });
    await db
      .prepare('INSERT INTO books_payment_batches (id, workspace_id, doc_type, date, account_id, currency, fx_rate, reference, total, journal_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, actor.ws, docType, date, bank.account_id, currency, payFx, reference, total, journalId, actor.person, ts);
    for (const p of pays) {
      await db
        .prepare(
          `INSERT INTO books_payments (id, workspace_id, doc_id, amount, date, method, account_id, fx_rate, reference, journal_id, created_by, created_at, base_cleared, batch_id)
           VALUES (?, ?, ?, ?, ?, 'bank', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(newId('pay'), actor.ws, p.d.id, p.amount, date, bank.account_id, payFx, reference, journalId, actor.person, ts, p.atDoc, id);
      const res = await db.prepare('UPDATE books_documents SET paid_total = paid_total + ?, updated_at = ? WHERE id = ? AND paid_total = ?').run(p.amount, ts, p.d.id, p.d.paid_total);
      if (!res.changes) throw new BooksError('conflict', 409);
      const after = (await getDocRow(actor.ws, p.d.id, db))!;
      const status = statusFor(after);
      await db.prepare('UPDATE books_documents SET status = ? WHERE id = ?').run(status, p.d.id);
      if (status === 'paid') paid.push(after);
    }
  });
  await audit(actor, 'batch.create', docType, id, `${input.allocations.length}`);
  if (docType === 'invoice' && paid.length) {
    const { onInvoicePaid } = await import('./books-integrations');
    const { getDocument } = await import('./books-docs');
    for (const p of paid) {
      const doc = await getDocument(actor.ws, p.id);
      if (doc) await onInvoicePaid(actor.ws, doc).catch((err) => console.error('[books] paid hook', err instanceof Error ? err.message : err));
    }
  }
  return (await getBatch(actor.ws, id))!;
}

function toDto(r: Record<string, unknown>): BatchDto {
  return {
    id: String(r.id),
    docType: r.doc_type as 'invoice' | 'bill',
    date: String(r.date),
    currency: String(r.currency),
    reference: String(r.reference ?? ''),
    total: Number(r.total),
    journalId: (r.journal_id as string) ?? null,
    bankTxnId: (r.bank_txn_id as string) ?? null,
    accountName: String(r.account_name ?? ''),
    count: Number(r.n ?? 0),
    createdAt: String(r.created_at),
  };
}

const SELECT = `SELECT b.*, a.name AS account_name, (SELECT COUNT(*) FROM books_payments p WHERE p.batch_id = b.id) AS n
  FROM books_payment_batches b LEFT JOIN books_accounts a ON a.id = b.account_id`;

export async function getBatch(ws: string, id: string): Promise<BatchDto | null> {
  const r = (await getDb().prepare(`${SELECT} WHERE b.id = ? AND b.workspace_id = ?`).get(id, ws)) as Record<string, unknown> | undefined;
  return r ? toDto(r) : null;
}

/** Lotes que el rol puede ver: `types` sale del rol (sales no ve los de compras). */
export async function listBatches(ws: string, types: Array<'invoice' | 'bill'>): Promise<BatchDto[]> {
  if (!types.length) return [];
  const rows = (await getDb()
    .prepare(`${SELECT} WHERE b.workspace_id = ? AND b.doc_type IN (${types.map(() => '?').join(',')}) ORDER BY b.date DESC, b.created_at DESC LIMIT 200`)
    .all(ws, ...types)) as Array<Record<string, unknown>>;
  return rows.map(toDto);
}

export async function batchDocuments(ws: string, id: string): Promise<Array<{ docId: string; docType: string; label: string; contactName: string; amount: number }>> {
  const rows = (await getDb()
    .prepare(
      `SELECT p.doc_id, p.amount, d.doc_type, d.number_label, c.name AS contact FROM books_payments p JOIN books_documents d ON d.id = p.doc_id LEFT JOIN books_contacts c ON c.id = d.contact_id
       WHERE p.batch_id = ? AND p.workspace_id = ? ORDER BY d.number_label`,
    )
    .all(id, ws)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({ docId: String(r.doc_id), docType: String(r.doc_type), label: String(r.number_label), contactName: String(r.contact ?? ''), amount: Number(r.amount) }));
}

/** Deshace el lote entero: revierte el asiento y devuelve el saldo a cada documento. */
export async function deleteBatch(actor: BooksActor, id: string): Promise<void> {
  const b = await getBatch(actor.ws, id);
  if (!b) throw new BooksError('not_found', 404);
  assertCan(actor, permFor(b.docType));
  if (b.bankTxnId) throw new BooksError('batch_reconciled', 409);
  const s = await ensureBooks(actor.ws);
  if (s.lock_date && b.date <= s.lock_date) throw new BooksError('period_locked', 409, { lockDate: s.lock_date });
  const ts = nowDb();
  await inTransaction(async (db) => {
    if (b.journalId) await reverseJournal(actor.ws, actor.person, b.journalId, { memo: `Batch removed ${b.reference}`.trim(), db });
    const pays = (await db.prepare('SELECT id, doc_id, amount FROM books_payments WHERE batch_id = ? AND workspace_id = ?').all(id, actor.ws)) as Array<{ id: string; doc_id: string; amount: number }>;
    for (const p of pays) {
      await db.prepare('DELETE FROM books_payments WHERE id = ?').run(p.id);
      await db.prepare('UPDATE books_documents SET paid_total = MAX(0, paid_total - ?), updated_at = ? WHERE id = ?').run(p.amount, ts, p.doc_id);
      const after = (await getDocRow(actor.ws, p.doc_id, db))!;
      await db.prepare('UPDATE books_documents SET status = ? WHERE id = ?').run(statusFor(after), p.doc_id);
    }
    await db.prepare('DELETE FROM books_payment_batches WHERE id = ?').run(id);
  });
  await audit(actor, 'batch.delete', b.docType, id, b.reference);
}
