/**
 * Books: cuentas bancarias, importación de extractos (CSV y OFX) y
 * conciliación. Server-only, salvo los parsers (puros, exportados para los
 * tests).
 *
 * Sin conexión en vivo con bancos: el extracto se sube a mano. Cada
 * movimiento lleva una clave (FITID del OFX o hash de fecha + importe +
 * descripción + ocurrencia) y la misma línea importada dos veces no se
 * duplica. Conciliar es: cobrar o pagar una factura abierta, vincular un
 * cobro ya registrado, o registrar el movimiento contra una cuenta (gasto,
 * comisión, ingreso). Las sugerencias puntúan importe, número o nombre en la
 * descripción y cercanía de fechas.
 */
import { createHash } from 'crypto';
import { getDb } from './db';
import { accountByKey, assertCan, audit, ensureBooks, getAccount } from './books';
import { amountDue, getDocRow, recordPayment } from './books-docs';
import { inTransaction, postJournal } from './books-ledger';
import { BooksError, clean, newId, nowDb, type BooksActor } from './books-schema';
import { convert, CURRENCY_RE, daysBetween, isValidDate, parseAmountDot, parseAmountLocal } from './books-money';

export interface BankAccountRow {
  id: string;
  workspace_id: string;
  account_id: string;
  name: string;
  bank_name: string;
  number_last4: string;
  currency: string;
  archived: number;
}

export interface BankAccountDto {
  id: string;
  accountId: string;
  name: string;
  bankName: string;
  last4: string;
  currency: string;
  archived: boolean;
  /** Saldo contable (libro) en la moneda base. */
  balance: number;
  unmatched: number;
  /** Saldo del extracto importado (suma de movimientos). */
  statementBalance: number;
}

export async function listBankAccounts(ws: string, opts: { includeArchived?: boolean } = {}): Promise<BankAccountDto[]> {
  await ensureBooks(ws);
  const rows = (await getDb()
    .prepare(
      `SELECT b.*,
        (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM books_journal_lines l WHERE l.account_id = b.account_id) AS balance,
        (SELECT COUNT(*) FROM books_bank_txns t WHERE t.bank_account_id = b.id AND t.status = 'unmatched') AS unmatched,
        (SELECT COALESCE(SUM(t.amount), 0) FROM books_bank_txns t WHERE t.bank_account_id = b.id) AS statement
       FROM books_bank_accounts b WHERE b.workspace_id = ?${opts.includeArchived ? '' : ' AND b.archived = 0'} ORDER BY b.created_at ASC`,
    )
    .all(ws)) as Array<BankAccountRow & { balance: number; unmatched: number; statement: number }>;
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    name: r.name,
    bankName: r.bank_name,
    last4: r.number_last4,
    currency: r.currency,
    archived: r.archived === 1,
    balance: Number(r.balance),
    unmatched: Number(r.unmatched),
    statementBalance: Number(r.statement),
  }));
}

export async function getBankAccountRow(ws: string, id: string): Promise<BankAccountRow | null> {
  return ((await getDb().prepare('SELECT * FROM books_bank_accounts WHERE id = ? AND workspace_id = ?').get(id, ws)) as BankAccountRow | undefined) ?? null;
}

/** Cuenta bancaria nueva con su cuenta contable (activo, banco). */
export async function createBankAccount(actor: BooksActor, input: { name: string; bankName?: string; last4?: string; currency?: string }): Promise<BankAccountDto> {
  assertCan(actor, 'banking.write');
  const s = await ensureBooks(actor.ws);
  const name = clean(input.name, 120);
  if (!name) throw new BooksError('invalid_name');
  const currency = (input.currency ?? s.base_currency).toUpperCase();
  if (!CURRENCY_RE.test(currency)) throw new BooksError('invalid_currency');
  if (currency !== s.base_currency) throw new BooksError('bank_currency_must_be_base', 400);
  const last4 = clean(input.last4 ?? '', 4).replace(/\D/g, '');
  const db = getDb();
  const bank = await accountByKey(actor.ws, 'bank');
  // Código siguiente al del banco del plan ("1010" → "1011", "1.1.02" → "1.1.02.01").
  const siblings = (await db.prepare('SELECT code FROM books_accounts WHERE workspace_id = ? AND code LIKE ?').all(actor.ws, `${bank.code}%`)) as Array<{ code: string }>;
  const sep = bank.code.includes('.') ? '.' : '';
  let code = '';
  for (let i = 1; i < 100 && !code; i++) {
    const cand = sep ? `${bank.code}.${String(i).padStart(2, '0')}` : `${bank.code}-${i}`;
    if (!siblings.some((x) => x.code === cand)) code = cand;
  }
  const ts = nowDb();
  const accId = newId('acc');
  const id = newId('bnk');
  await db
    .prepare("INSERT INTO books_accounts (id, workspace_id, code, name, type, subtype, created_at, updated_at) VALUES (?, ?, ?, ?, 'asset', 'bank', ?, ?)")
    .run(accId, actor.ws, code, name, ts, ts);
  await db
    .prepare('INSERT INTO books_bank_accounts (id, workspace_id, account_id, name, bank_name, number_last4, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.ws, accId, name, clean(input.bankName ?? '', 120), last4, currency, ts, ts);
  await audit(actor, 'bank.create', 'bank_account', id, name);
  return (await listBankAccounts(actor.ws)).find((b) => b.id === id)!;
}

export async function updateBankAccount(actor: BooksActor, id: string, patch: { name?: string; bankName?: string; last4?: string; archived?: boolean }): Promise<BankAccountDto> {
  assertCan(actor, 'banking.write');
  const b = await getBankAccountRow(actor.ws, id);
  if (!b) throw new BooksError('not_found', 404);
  const name = patch.name !== undefined ? clean(patch.name, 120) : b.name;
  if (!name) throw new BooksError('invalid_name');
  const ts = nowDb();
  await getDb()
    .prepare('UPDATE books_bank_accounts SET name = ?, bank_name = ?, number_last4 = ?, archived = ?, updated_at = ? WHERE id = ?')
    .run(name, patch.bankName !== undefined ? clean(patch.bankName, 120) : b.bank_name, patch.last4 !== undefined ? clean(patch.last4, 4).replace(/\D/g, '') : b.number_last4, patch.archived === undefined ? b.archived : patch.archived ? 1 : 0, ts, id);
  if (patch.name !== undefined) await getDb().prepare('UPDATE books_accounts SET name = ?, updated_at = ? WHERE id = ? AND system_key IS NULL').run(name, ts, b.account_id);
  await audit(actor, 'bank.update', 'bank_account', id, name);
  return (await listBankAccounts(actor.ws, { includeArchived: true })).find((x) => x.id === id)!;
}

/** Sin movimientos ni asientos se borra; si no, se archiva. */
export async function deleteBankAccount(actor: BooksActor, id: string): Promise<{ archived: boolean }> {
  assertCan(actor, 'banking.write');
  const b = await getBankAccountRow(actor.ws, id);
  if (!b) throw new BooksError('not_found', 404);
  const db = getDb();
  const used = (await db.prepare('SELECT 1 AS x FROM books_journal_lines WHERE account_id = ? LIMIT 1').get(b.account_id)) || (await db.prepare('SELECT 1 AS x FROM books_bank_txns WHERE bank_account_id = ? LIMIT 1').get(id));
  if (used) {
    await db.prepare('UPDATE books_bank_accounts SET archived = 1, updated_at = ? WHERE id = ?').run(nowDb(), id);
    await audit(actor, 'bank.archive', 'bank_account', id, b.name);
    return { archived: true };
  }
  await db.prepare('DELETE FROM books_bank_accounts WHERE id = ?').run(id);
  await db.prepare('DELETE FROM books_accounts WHERE id = ? AND system_key IS NULL').run(b.account_id);
  await audit(actor, 'bank.delete', 'bank_account', id, b.name);
  return { archived: false };
}

// ---------- Parsers ----------

export interface ParsedTxn {
  date: string;
  description: string;
  /** Unidades mínimas, positivo = entra plata. */
  amount: number;
  /** FITID del OFX (si hay). */
  fitId?: string;
}

/** Separa una línea CSV respetando comillas. */
export function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) (out.push(cur), (cur = ''));
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** "31/12/2026", "2026-12-31", "12/31/2026" (si el día no entra como día), "31-12-26". */
export function parseStatementDate(raw: string, dayFirst = true): string | null {
  const s = raw.trim().replace(/\s.*$/, '');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) {
    const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return isValidDate(d) ? d : null;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    let [a, b] = [Number(m[1]), Number(m[2])];
    if (!dayFirst || b > 12) [a, b] = [b, a];
    if (a > 12 && b > 12) return null;
    const d = `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    return isValidDate(d) ? d : null;
  }
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (m) {
    const d = `${m[1]}-${m[2]}-${m[3]}`;
    return isValidDate(d) ? d : null;
  }
  return null;
}

const DATE_HEADERS = ['date', 'fecha', 'data', 'posted', 'booking date', 'fecha valor', 'fecha operacion', 'fecha operación', 'transaction date'];
const DESC_HEADERS = ['description', 'descripcion', 'descripción', 'concepto', 'detalle', 'memo', 'payee', 'referencia', 'historico', 'histórico', 'details', 'narrative'];
const AMOUNT_HEADERS = ['amount', 'importe', 'monto', 'valor', 'value'];
const DEBIT_HEADERS = ['debit', 'debito', 'débito', 'debe', 'withdrawal', 'cargo', 'egreso', 'saida', 'saída'];
const CREDIT_HEADERS = ['credit', 'credito', 'crédito', 'haber', 'deposit', 'abono', 'ingreso', 'entrada'];

function findCol(headers: string[], names: string[]): number {
  const norm = headers.map((h) => h.toLowerCase().replace(/^﻿/, '').trim());
  for (const n of names) {
    const i = norm.indexOf(n);
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = norm.findIndex((h) => h.includes(n));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * CSV de extracto: detecta el separador (, ; o tab) y las columnas por
 * nombre (fecha, descripción, importe o débito/crédito, en/es/pt). Devuelve
 * los movimientos y los errores por fila.
 */
export function parseCsvStatement(text: string, currency: string, opts: { dayFirst?: boolean } = {}): { txns: ParsedTxn[]; errors: Array<{ row: number; error: string }> } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return { txns: [], errors: [{ row: 0, error: 'empty' }] };
  const first = lines[0];
  const delim = [';', '\t', ','].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const headers = splitCsvLine(first, delim);
  const iDate = findCol(headers, DATE_HEADERS);
  const iDesc = findCol(headers, DESC_HEADERS);
  const iAmt = findCol(headers, AMOUNT_HEADERS);
  const iDeb = findCol(headers, DEBIT_HEADERS);
  const iCred = findCol(headers, CREDIT_HEADERS);
  if (iDate < 0 || (iAmt < 0 && iDeb < 0 && iCred < 0)) return { txns: [], errors: [{ row: 1, error: 'columns_not_found' }] };
  const txns: ParsedTxn[] = [];
  const errors: Array<{ row: number; error: string }> = [];
  for (let r = 1; r < lines.length && r <= 5000; r++) {
    const cells = splitCsvLine(lines[r], delim);
    const date = parseStatementDate(cells[iDate] ?? '', opts.dayFirst ?? true);
    if (!date) {
      errors.push({ row: r + 1, error: 'invalid_date' });
      continue;
    }
    let amount: number | null = null;
    // CSV: la convención de la moneda (en ARS y BRL el punto es de miles).
    if (iAmt >= 0 && (cells[iAmt] ?? '').trim()) amount = parseAmountLocal(cells[iAmt], currency);
    else {
      const deb = iDeb >= 0 && (cells[iDeb] ?? '').trim() ? parseAmountLocal(cells[iDeb], currency) : 0;
      const cred = iCred >= 0 && (cells[iCred] ?? '').trim() ? parseAmountLocal(cells[iCred], currency) : 0;
      amount = deb == null || cred == null ? null : Math.abs(cred) - Math.abs(deb);
    }
    if (amount == null || amount === 0) {
      errors.push({ row: r + 1, error: 'invalid_amount' });
      continue;
    }
    txns.push({ date, description: clean(iDesc >= 0 ? (cells[iDesc] ?? '') : '', 300), amount });
  }
  return { txns, errors };
}

/** OFX (SGML o XML): los STMTTRN con DTPOSTED, TRNAMT, FITID y NAME/MEMO. */
export function parseOfx(text: string, currency: string): { txns: ParsedTxn[]; errors: Array<{ row: number; error: string }> } {
  const txns: ParsedTxn[] = [];
  const errors: Array<{ row: number; error: string }> = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const tag = (block: string, name: string) => {
    const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block);
    return m ? m[1].trim() : '';
  };
  blocks.slice(0, 5000).forEach((raw, i) => {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const date = parseStatementDate(tag(block, 'DTPOSTED'));
    // OFX: el estándar siempre usa punto decimal.
    const amount = parseAmountDot(tag(block, 'TRNAMT').replace(/^\+/, ''), currency);
    if (!date || amount == null || amount === 0) {
      errors.push({ row: i + 1, error: !date ? 'invalid_date' : 'invalid_amount' });
      return;
    }
    const name = tag(block, 'NAME');
    const memo = tag(block, 'MEMO');
    txns.push({ date, description: clean([name, memo].filter(Boolean).join(' · '), 300), amount, fitId: tag(block, 'FITID') || undefined });
  });
  if (!blocks.length) errors.push({ row: 0, error: 'no_transactions' });
  return { txns, errors };
}

/** Clave de cada movimiento: FITID, o hash de fecha+importe+descripción y su ocurrencia dentro del archivo. */
export function dedupeKeys(txns: ParsedTxn[]): string[] {
  const seen = new Map<string, number>();
  return txns.map((t) => {
    if (t.fitId) return `fit:${t.fitId}`;
    const base = `${t.date}|${t.amount}|${t.description.toLowerCase().replace(/\s+/g, ' ')}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `h:${createHash('sha256').update(`${base}|${n}`).digest('hex').slice(0, 32)}`;
  });
}

export async function importStatement(
  actor: BooksActor,
  bankAccountId: string,
  input: { filename: string; text: string; dayFirst?: boolean },
): Promise<{ imported: number; duplicates: number; errors: Array<{ row: number; error: string }> }> {
  assertCan(actor, 'banking.write');
  const b = await getBankAccountRow(actor.ws, bankAccountId);
  if (!b) throw new BooksError('not_found', 404);
  if (input.text.length > 5_000_000) throw new BooksError('file_too_large', 413);
  const isOfx = /\.(ofx|qfx)$/i.test(input.filename) || /<OFX>/i.test(input.text.slice(0, 2000));
  const parsed = isOfx ? parseOfx(input.text, b.currency) : parseCsvStatement(input.text, b.currency, { dayFirst: input.dayFirst });
  const keys = dedupeKeys(parsed.txns);
  const importId = newId('imp');
  const ts = nowDb();
  let imported = 0;
  let duplicates = 0;
  const db = getDb();
  for (let i = 0; i < parsed.txns.length; i++) {
    const t = parsed.txns[i];
    const res = await db
      .prepare('INSERT OR IGNORE INTO books_bank_txns (id, workspace_id, bank_account_id, date, description, amount, dedupe_key, import_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId('btx'), actor.ws, b.id, t.date, t.description, t.amount, keys[i], importId, ts);
    if (res.changes) imported++;
    else duplicates++;
  }
  await audit(actor, 'bank.import', 'bank_account', b.id, `${imported} imported, ${duplicates} duplicates`);
  return { imported, duplicates, errors: parsed.errors.slice(0, 50) };
}

export interface BankTxnDto {
  id: string;
  date: string;
  description: string;
  amount: number;
  status: 'unmatched' | 'matched' | 'ignored';
  paymentId: string | null;
  journalId: string | null;
  matchLabel: string | null;
}

export async function listTxns(ws: string, bankAccountId: string, opts: { status?: string; limit?: number } = {}): Promise<BankTxnDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT t.*, d.number_label AS doc_label, d.id AS doc_id, j.memo AS jmemo FROM books_bank_txns t
       LEFT JOIN books_payments p ON p.id = t.payment_id LEFT JOIN books_documents d ON d.id = p.doc_id LEFT JOIN books_journals j ON j.id = t.journal_id
       WHERE t.workspace_id = ? AND t.bank_account_id = ?${opts.status ? ' AND t.status = ?' : ''} ORDER BY t.date DESC, t.created_at DESC LIMIT ?`,
    )
    .all(...(opts.status ? [ws, bankAccountId, opts.status] : [ws, bankAccountId]), Math.min(opts.limit ?? 500, 2000))) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    date: String(r.date),
    description: String(r.description),
    amount: Number(r.amount),
    status: r.status as BankTxnDto['status'],
    paymentId: (r.payment_id as string) ?? null,
    journalId: (r.journal_id as string) ?? null,
    matchLabel: (r.doc_label as string) ?? (r.jmemo as string) ?? null,
  }));
}

// ---------- Sugerencias ----------

export interface MatchCandidate {
  kind: 'invoice' | 'bill' | 'payment';
  /** Documento (invoice/bill) o cobro ya registrado (payment). */
  id: string;
  docId: string;
  label: string;
  contactName: string;
  amount: number;
  date: string;
  score: number;
}

export interface MatchableDoc {
  id: string;
  docType: 'invoice' | 'bill';
  label: string;
  contactName: string;
  due: number;
  date: string;
  dueDate: string | null;
}

export interface MatchablePayment {
  id: string;
  docId: string;
  label: string;
  contactName: string;
  amount: number;
  date: string;
  incoming: boolean;
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

/**
 * Puntaje (puro) de un candidato para un movimiento: importe exacto 60,
 * número del comprobante en la descripción 25, nombre del contacto 15,
 * fecha cercana hasta 10 (menos con los días). Debajo de 50 no se sugiere.
 */
export function scoreCandidate(txn: { date: string; description: string; amount: number }, c: { label: string; contactName: string; amount: number; date: string }): number {
  let score = 0;
  if (Math.abs(txn.amount) === c.amount) score += 60;
  else if (Math.abs(Math.abs(txn.amount) - c.amount) <= Math.max(1, Math.round(c.amount * 0.005))) score += 30;
  const desc = txn.description.toLowerCase();
  const digits = c.label.replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length >= 2 && desc.replace(/\D/g, ' ').split(' ').some((t) => t.replace(/^0+/, '') === digits)) score += 25;
  else if (c.label && desc.includes(c.label.toLowerCase())) score += 25;
  const dw = new Set(words(txn.description));
  const cw = words(c.contactName);
  if (cw.length && cw.some((w) => dw.has(w))) score += 15;
  const days = Math.abs(daysBetween(c.date, txn.date));
  score += Math.max(0, 10 - Math.floor(days / 3));
  return score;
}

/** Candidatos ordenados (puro): facturas abiertas por saldo y cobros sin conciliar. */
export function rankCandidates(txn: { date: string; description: string; amount: number }, docs: MatchableDoc[], payments: MatchablePayment[]): MatchCandidate[] {
  const incoming = txn.amount > 0;
  const out: MatchCandidate[] = [];
  for (const d of docs) {
    if ((d.docType === 'invoice') !== incoming) continue;
    out.push({ kind: d.docType, id: d.id, docId: d.id, label: d.label, contactName: d.contactName, amount: d.due, date: d.date, score: scoreCandidate(txn, { label: d.label, contactName: d.contactName, amount: d.due, date: d.dueDate ?? d.date }) });
  }
  for (const p of payments) {
    if (p.incoming !== incoming) continue;
    // Un cobro ya registrado con el mismo importe es la mejor coincidencia: suma 10.
    out.push({ kind: 'payment', id: p.id, docId: p.docId, label: p.label, contactName: p.contactName, amount: p.amount, date: p.date, score: scoreCandidate(txn, p) + 10 });
  }
  return out.filter((c) => c.score >= 50).sort((a, b) => b.score - a.score).slice(0, 5);
}

async function matchables(ws: string, bankLedgerId: string, baseCurrency: string) {
  const docs = (await getDb()
    .prepare(
      `SELECT d.id, d.doc_type, d.number_label, d.total, d.paid_total, d.credited_total, d.status, d.issue_date, d.due_date, c.name AS contact_name
       FROM books_documents d LEFT JOIN books_contacts c ON c.id = d.contact_id
       WHERE d.workspace_id = ? AND d.doc_type IN ('invoice','bill') AND d.status IN ('sent','partial','overdue') AND d.currency = ? LIMIT 1000`,
    )
    .all(ws, baseCurrency)) as Array<Record<string, unknown>>;
  const payments = (await getDb()
    .prepare(
      `SELECT p.id, p.doc_id, p.amount, p.date, d.doc_type, d.number_label, c.name AS contact_name FROM books_payments p
       JOIN books_documents d ON d.id = p.doc_id LEFT JOIN books_contacts c ON c.id = d.contact_id
       WHERE p.workspace_id = ? AND p.account_id = ? AND p.bank_txn_id IS NULL AND d.currency = ? ORDER BY p.date DESC LIMIT 500`,
    )
    .all(ws, bankLedgerId, baseCurrency)) as Array<Record<string, unknown>>;
  return {
    docs: docs.map(
      (d): MatchableDoc => ({
        id: String(d.id),
        docType: d.doc_type as 'invoice' | 'bill',
        label: String(d.number_label),
        contactName: String(d.contact_name ?? ''),
        due: amountDue({ total: Number(d.total), paid_total: Number(d.paid_total), credited_total: Number(d.credited_total), status: d.status as 'sent' }),
        date: String(d.issue_date),
        dueDate: (d.due_date as string) ?? null,
      }),
    ),
    payments: payments.map(
      (p): MatchablePayment => ({
        id: String(p.id),
        docId: String(p.doc_id),
        label: String(p.number_label),
        contactName: String(p.contact_name ?? ''),
        amount: Number(p.amount),
        date: String(p.date),
        incoming: p.doc_type !== 'bill',
      }),
    ),
  };
}

export async function suggestions(ws: string, bankAccountId: string): Promise<Record<string, MatchCandidate[]>> {
  const s = await ensureBooks(ws);
  const b = await getBankAccountRow(ws, bankAccountId);
  if (!b) throw new BooksError('not_found', 404);
  const txns = await listTxns(ws, bankAccountId, { status: 'unmatched', limit: 300 });
  const pool = await matchables(ws, b.account_id, s.base_currency);
  const out: Record<string, MatchCandidate[]> = {};
  for (const t of txns) {
    const ranked = rankCandidates(t, pool.docs, pool.payments);
    if (ranked.length) out[t.id] = ranked;
  }
  return out;
}

// ---------- Conciliar ----------

async function txnRow(ws: string, id: string) {
  return (await getDb().prepare('SELECT * FROM books_bank_txns WHERE id = ? AND workspace_id = ?').get(id, ws)) as
    | { id: string; bank_account_id: string; date: string; description: string; amount: number; status: string }
    | undefined;
}

/** Marca conciliado con compare-and-set (dos personas conciliando la misma línea: una gana). */
async function claimTxn(id: string, fields: { paymentId?: string | null; journalId?: string | null; status?: 'matched' | 'ignored' }): Promise<boolean> {
  const res = await getDb()
    .prepare("UPDATE books_bank_txns SET status = ?, payment_id = ?, journal_id = ? WHERE id = ? AND status = 'unmatched'")
    .run(fields.status ?? 'matched', fields.paymentId ?? null, fields.journalId ?? null, id);
  return res.changes > 0;
}

export async function reconcile(
  actor: BooksActor,
  txnId: string,
  input: { kind: 'invoice' | 'bill'; docId: string } | { kind: 'payment'; paymentId: string } | { kind: 'account'; accountId: string; description?: string } | { kind: 'ignore' },
): Promise<BankTxnDto> {
  assertCan(actor, 'banking.write');
  const t = await txnRow(actor.ws, txnId);
  if (!t) throw new BooksError('not_found', 404);
  if (t.status !== 'unmatched') throw new BooksError('already_matched', 409);
  const b = (await getBankAccountRow(actor.ws, t.bank_account_id))!;
  const s = await ensureBooks(actor.ws);
  if (input.kind === 'ignore') {
    if (!(await claimTxn(t.id, { status: 'ignored' }))) throw new BooksError('already_matched', 409);
  } else if (input.kind === 'payment') {
    const p = (await getDb().prepare('SELECT * FROM books_payments WHERE id = ? AND workspace_id = ?').get(input.paymentId, actor.ws)) as
      | { id: string; amount: number; account_id: string; bank_txn_id: string | null }
      | undefined;
    if (!p || p.account_id !== b.account_id || p.bank_txn_id) throw new BooksError('invalid_payment', 409);
    if (p.amount !== Math.abs(t.amount)) throw new BooksError('amount_mismatch', 409);
    const claimed = await getDb().prepare('UPDATE books_payments SET bank_txn_id = ? WHERE id = ? AND bank_txn_id IS NULL').run(t.id, p.id);
    if (!claimed.changes || !(await claimTxn(t.id, { paymentId: p.id }))) throw new BooksError('already_matched', 409);
  } else if (input.kind === 'invoice' || input.kind === 'bill') {
    const d = await getDocRow(actor.ws, input.docId);
    if (!d || d.doc_type !== input.kind) throw new BooksError('not_found', 404);
    if ((input.kind === 'invoice') !== t.amount > 0) throw new BooksError('direction_mismatch', 409);
    if (d.currency !== b.currency) throw new BooksError('currency_mismatch', 409);
    const amount = Math.min(Math.abs(t.amount), amountDue(d));
    if (amount <= 0) throw new BooksError('nothing_due', 409);
    if (Math.abs(t.amount) > amountDue(d)) throw new BooksError('amount_exceeds_due', 409, { due: amountDue(d) });
    // Primero se reclama la línea (nadie más la concilia), después se registra el cobro.
    if (!(await claimTxn(t.id, {}))) throw new BooksError('already_matched', 409);
    try {
      const res = await recordPayment(actor, d.id, { amount, date: t.date, accountId: b.account_id, method: 'bank', reference: t.description.slice(0, 120), bankTxnId: t.id }, { system: false });
      await getDb().prepare('UPDATE books_bank_txns SET payment_id = ? WHERE id = ?').run(res.paymentId, t.id);
    } catch (err) {
      await getDb().prepare("UPDATE books_bank_txns SET status = 'unmatched', payment_id = NULL WHERE id = ?").run(t.id);
      throw err;
    }
  } else {
    // Registrar contra una cuenta: gasto, comisión, ingreso, aporte...
    const target = input as { kind: 'account'; accountId: string; description?: string };
    const acc = await getAccount(actor.ws, target.accountId);
    if (!acc || acc.archived || acc.id === b.account_id) throw new BooksError('invalid_account');
    if (!(await claimTxn(t.id, {}))) throw new BooksError('already_matched', 409);
    try {
      const amount = convert(Math.abs(t.amount), b.currency, '1', s.base_currency);
      const memo = clean(target.description ?? t.description, 200);
      const journalId = await postJournal(actor.ws, actor.person, {
        date: t.date,
        memo,
        sourceType: 'bank',
        sourceId: t.id,
        lines: t.amount > 0 ? [{ accountId: b.account_id, debit: amount }, { accountId: acc.id, credit: amount, description: memo }] : [{ accountId: acc.id, debit: amount, description: memo }, { accountId: b.account_id, credit: amount }],
      });
      await getDb().prepare('UPDATE books_bank_txns SET journal_id = ? WHERE id = ?').run(journalId, t.id);
    } catch (err) {
      await getDb().prepare("UPDATE books_bank_txns SET status = 'unmatched' WHERE id = ?").run(t.id);
      throw err;
    }
  }
  await audit(actor, `bank.reconcile.${input.kind}`, 'bank_txn', t.id, '');
  return (await listTxns(actor.ws, b.id)).find((x) => x.id === t.id)!;
}

/** Deshace una conciliación: ignorada vuelve a pendiente; vinculada a un cobro, lo desvincula; registrada contra una cuenta, revierte el asiento. */
export async function unreconcile(actor: BooksActor, txnId: string): Promise<BankTxnDto> {
  assertCan(actor, 'banking.write');
  const t = (await getDb().prepare('SELECT * FROM books_bank_txns WHERE id = ? AND workspace_id = ?').get(txnId, actor.ws)) as
    | { id: string; bank_account_id: string; status: string; payment_id: string | null; journal_id: string | null }
    | undefined;
  if (!t) throw new BooksError('not_found', 404);
  if (t.status === 'unmatched') return (await listTxns(actor.ws, t.bank_account_id)).find((x) => x.id === t.id)!;
  await inTransaction(async (db) => {
    if (t.journal_id) {
      const { reverseJournal } = await import('./books-ledger');
      await reverseJournal(actor.ws, actor.person, t.journal_id, { memo: 'Bank line unreconciled', db });
    }
    if (t.payment_id) await db.prepare('UPDATE books_payments SET bank_txn_id = NULL WHERE id = ? AND bank_txn_id = ?').run(t.payment_id, t.id);
    await db.prepare("UPDATE books_bank_txns SET status = 'unmatched', payment_id = NULL, journal_id = NULL WHERE id = ?").run(t.id);
  });
  await audit(actor, 'bank.unreconcile', 'bank_txn', t.id, '');
  return (await listTxns(actor.ws, t.bank_account_id)).find((x) => x.id === t.id)!;
}

