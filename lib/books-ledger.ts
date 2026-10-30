/**
 * Books: libro diario por partida doble. Server-only.
 *
 * Reglas que se cumplen acá y en la base:
 * - Un asiento siempre balancea (debe = haber, en la moneda base): se valida
 *   antes de escribir y se vuelve a sumar dentro de la misma transacción de
 *   escritura antes del commit. Si no da cero, rollback.
 * - Ninguna fecha anterior o igual al cierre (lock_date) acepta asientos.
 * - Los asientos no se editan ni se borran (triggers en la base): se
 *   corrigen con un asiento de reversa.
 * - Cada línea va al debe o al haber, nunca a los dos, y nunca negativa.
 */
import { ensureMigrated, getClient, getDb, txDb, type Db } from './db';
import { accountByKey, assertCan, audit, ensureBooks, getAccount } from './books';
import { BooksError, clean, newId, nowDb, type BooksActor } from './books-schema';
import { isValidDate } from './books-money';
import type { SystemKey } from './books-templates';

export interface JournalLineInput {
  accountId: string;
  debit?: number;
  credit?: number;
  contactId?: string | null;
  taxRateId?: string | null;
  description?: string;
}

export interface JournalInput {
  date: string;
  memo?: string;
  sourceType: 'invoice' | 'credit_note' | 'bill' | 'payment' | 'expense' | 'manual' | 'reversal' | 'void' | 'shop_order' | 'bank';
  sourceId?: string | null;
  reversalOf?: string | null;
  lines: JournalLineInput[];
}

/** Junta líneas a la misma cuenta y lado, saca las de cero y deja cada línea en un solo lado. */
export function normalizeLines(lines: JournalLineInput[]): JournalLineInput[] {
  const out: JournalLineInput[] = [];
  for (const l of lines) {
    const debit = Math.trunc(l.debit ?? 0);
    const credit = Math.trunc(l.credit ?? 0);
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) throw new BooksError('invalid_amount');
    // Un importe negativo pasa al otro lado (una devolución en una línea de venta, por ejemplo).
    const net = debit - credit;
    if (net === 0) continue;
    out.push({ ...l, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 });
  }
  return out;
}

export function isBalanced(lines: JournalLineInput[]): boolean {
  const d = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
  const c = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
  return d === c && d > 0;
}

/** Fecha cerrada: igual o anterior al cierre. */
export function isLocked(date: string, lockDate: string | null | undefined): boolean {
  return Boolean(lockDate) && date <= (lockDate as string);
}

async function writeJournal(db: Db, ws: string, person: string | null, input: Omit<JournalInput, 'lines'>, lines: JournalLineInput[]): Promise<string> {
  // Número correlativo con compare-and-set dentro de la transacción.
  const s = (await db.prepare('SELECT next_journal FROM books_settings WHERE workspace_id = ?').get(ws)) as { next_journal: number };
  const number = Number(s.next_journal);
  const bumped = await db.prepare('UPDATE books_settings SET next_journal = ? WHERE workspace_id = ? AND next_journal = ?').run(number + 1, ws, number);
  if (!bumped.changes) throw new BooksError('conflict', 409);
  const id = newId('jnl');
  await db
    .prepare('INSERT INTO books_journals (id, workspace_id, number, date, memo, source_type, source_id, reversal_of, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, ws, number, input.date, clean(input.memo ?? '', 300), input.sourceType, input.sourceId ?? null, input.reversalOf ?? null, person, nowDb());
  for (const l of lines) {
    await db
      .prepare('INSERT INTO books_journal_lines (id, journal_id, workspace_id, account_id, debit, credit, contact_id, tax_rate_id, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId('jl'), id, ws, l.accountId, l.debit ?? 0, l.credit ?? 0, l.contactId ?? null, l.taxRateId ?? null, clean(l.description ?? '', 200));
  }
  // La base vuelve a sumar lo que quedó escrito: si no da cero, no se confirma nada.
  const sum = (await db.prepare('SELECT COALESCE(SUM(debit), 0) AS d, COALESCE(SUM(credit), 0) AS c FROM books_journal_lines WHERE journal_id = ?').get(id)) as { d: number; c: number };
  if (Number(sum.d) !== Number(sum.c) || Number(sum.d) === 0) throw new BooksError('unbalanced', 422);
  return id;
}

/**
 * Valida y escribe un asiento en una transacción propia, o en la que se le
 * pasa (`db` de txDb) para que el documento y su asiento queden juntos.
 */
export async function postJournal(ws: string, person: string | null, input: JournalInput, opts: { db?: Db } = {}): Promise<string> {
  if (!isValidDate(input.date)) throw new BooksError('invalid_date');
  const settings = await ensureBooks(ws);
  if (isLocked(input.date, settings.lock_date)) throw new BooksError('period_locked', 409, { lockDate: settings.lock_date });
  const lines = normalizeLines(input.lines);
  if (lines.length < 2 || !isBalanced(lines)) throw new BooksError('unbalanced', 422);
  // Cuentas del workspace (y activas, salvo reversas de cuentas archivadas después).
  const ids = [...new Set(lines.map((l) => l.accountId))];
  for (const id of ids) {
    const acc = await getAccount(ws, id);
    if (!acc) throw new BooksError('invalid_account', 400, { accountId: id });
    if (acc.archived && input.sourceType !== 'reversal' && input.sourceType !== 'void') throw new BooksError('account_archived', 409, { accountId: id });
  }
  // Contacto y tasa de cada línea: del mismo workspace (nada apunta a datos ajenos).
  const reader = opts.db ?? getDb();
  for (const cid of [...new Set(lines.map((l) => l.contactId).filter((x): x is string => Boolean(x)))]) {
    if (!(await reader.prepare('SELECT 1 AS x FROM books_contacts WHERE id = ? AND workspace_id = ?').get(cid, ws))) throw new BooksError('invalid_contact', 400);
  }
  for (const tid of [...new Set(lines.map((l) => l.taxRateId).filter((x): x is string => Boolean(x)))]) {
    if (!(await reader.prepare('SELECT 1 AS x FROM books_tax_rates WHERE id = ? AND workspace_id = ?').get(tid, ws))) throw new BooksError('invalid_tax_rate', 400);
  }
  if (opts.db) return writeJournal(opts.db, ws, person, input, lines);
  return inTransaction((db) => writeJournal(db, ws, person, input, lines));
}

/** Corre `fn` en una transacción de escritura: commit si termina, rollback si tira. */
export async function inTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  await ensureMigrated();
  // Otra escritura en curso (SQLite local: BEGIN IMMEDIATE devuelve BUSY): se reintenta con espera corta.
  let tx: Awaited<ReturnType<ReturnType<typeof getClient>['transaction']>> | null = null;
  for (let attempt = 0; !tx; attempt++) {
    try {
      tx = await getClient().transaction('write');
    } catch (err) {
      if (attempt >= 40 || !(err instanceof Error && /SQLITE_BUSY|database is locked/i.test(err.message))) throw err;
      await new Promise((r) => setTimeout(r, 25 + Math.random() * 50));
    }
  }
  try {
    const out = await fn(txDb(tx));
    await tx.commit();
    return out;
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  } finally {
    tx.close();
  }
}

export interface JournalLineDto {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  contactId: string | null;
  description: string;
}

export interface JournalDto {
  id: string;
  number: number;
  date: string;
  memo: string;
  sourceType: string;
  sourceId: string | null;
  reversalOf: string | null;
  reversedBy: string | null;
  createdBy: string | null;
  createdAt: string;
  total: number;
  lines: JournalLineDto[];
}

export async function getJournal(ws: string, id: string): Promise<JournalDto | null> {
  const j = (await getDb().prepare('SELECT * FROM books_journals WHERE id = ? AND workspace_id = ?').get(id, ws)) as Record<string, unknown> | undefined;
  if (!j) return null;
  const lines = (await getDb()
    .prepare(
      `SELECT l.*, a.code, a.name FROM books_journal_lines l JOIN books_accounts a ON a.id = l.account_id WHERE l.journal_id = ? ORDER BY l.debit DESC, l.rowid ASC`,
    )
    .all(id)) as Array<Record<string, unknown>>;
  const dto = lines.map((l) => ({
    id: String(l.id),
    accountId: String(l.account_id),
    accountCode: String(l.code),
    accountName: String(l.name),
    debit: Number(l.debit),
    credit: Number(l.credit),
    contactId: (l.contact_id as string) ?? null,
    description: String(l.description ?? ''),
  }));
  return {
    id: String(j.id),
    number: Number(j.number),
    date: String(j.date),
    memo: String(j.memo ?? ''),
    sourceType: String(j.source_type),
    sourceId: (j.source_id as string) ?? null,
    reversalOf: (j.reversal_of as string) ?? null,
    reversedBy: (j.reversed_by as string) ?? null,
    createdBy: (j.created_by as string) ?? null,
    createdAt: String(j.created_at),
    total: dto.reduce((s, l) => s + l.debit, 0),
    lines: dto,
  };
}

export async function listJournals(
  ws: string,
  opts: { from?: string; to?: string; accountId?: string; sourceType?: string; q?: string; limit?: number } = {},
): Promise<Array<Omit<JournalDto, 'lines'>>> {
  await ensureBooks(ws);
  const where = ['j.workspace_id = ?'];
  const args: Array<string | number> = [ws];
  if (opts.from) (where.push('j.date >= ?'), args.push(opts.from));
  if (opts.to) (where.push('j.date <= ?'), args.push(opts.to));
  if (opts.sourceType) (where.push('j.source_type = ?'), args.push(opts.sourceType));
  if (opts.accountId) (where.push('EXISTS (SELECT 1 FROM books_journal_lines x WHERE x.journal_id = j.id AND x.account_id = ?)'), args.push(opts.accountId));
  if (opts.q?.trim()) (where.push("(j.memo LIKE ? ESCAPE '\\' OR CAST(j.number AS TEXT) = ?)"), args.push(`%${opts.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`, opts.q.trim()));
  const rows = (await getDb()
    .prepare(
      `SELECT j.*, (SELECT COALESCE(SUM(debit), 0) FROM books_journal_lines WHERE journal_id = j.id) AS total
       FROM books_journals j WHERE ${where.join(' AND ')} ORDER BY j.date DESC, j.number DESC LIMIT ?`,
    )
    .all(...args, Math.min(opts.limit ?? 200, 1000))) as Array<Record<string, unknown>>;
  return rows.map((j) => ({
    id: String(j.id),
    number: Number(j.number),
    date: String(j.date),
    memo: String(j.memo ?? ''),
    sourceType: String(j.source_type),
    sourceId: (j.source_id as string) ?? null,
    reversalOf: (j.reversal_of as string) ?? null,
    reversedBy: (j.reversed_by as string) ?? null,
    createdBy: (j.created_by as string) ?? null,
    createdAt: String(j.created_at),
    total: Number(j.total),
  }));
}

/** Asiento manual (contador): debe = haber, fecha abierta. */
export async function createManualJournal(actor: BooksActor, input: { date: string; memo?: string; lines: JournalLineInput[] }): Promise<JournalDto> {
  assertCan(actor, 'accounting.write');
  if (!Array.isArray(input.lines) || input.lines.length > 200) throw new BooksError('invalid_input');
  const id = await postJournal(actor.ws, actor.person, { date: input.date, memo: input.memo, sourceType: 'manual', lines: input.lines });
  await audit(actor, 'journal.create', 'journal', id, clean(input.memo ?? '', 120));
  return (await getJournal(actor.ws, id))!;
}

/**
 * Reversa: un asiento con los mismos importes en el lado contrario, con la
 * fecha pedida (por defecto la del original, o hoy si esa está cerrada).
 * El original queda marcado (reversed_by) y no se puede revertir dos veces.
 */
export async function reverseJournal(
  ws: string,
  person: string | null,
  journalId: string,
  opts: { date?: string; memo?: string; sourceType?: 'reversal' | 'void'; db?: Db } = {},
): Promise<string> {
  const db = opts.db ?? getDb();
  const j = (await db.prepare('SELECT * FROM books_journals WHERE id = ? AND workspace_id = ?').get(journalId, ws)) as
    | { id: string; date: string; memo: string; reversed_by: string | null; reversal_of: string | null; number: number }
    | undefined;
  if (!j) throw new BooksError('not_found', 404);
  if (j.reversed_by) throw new BooksError('already_reversed', 409);
  if (j.reversal_of) throw new BooksError('cannot_reverse_reversal', 409);
  const lines = (await db.prepare('SELECT * FROM books_journal_lines WHERE journal_id = ?').all(journalId)) as Array<{
    account_id: string;
    debit: number;
    credit: number;
    contact_id: string | null;
    tax_rate_id: string | null;
    description: string;
  }>;
  const settings = await ensureBooks(ws);
  const today = new Date().toISOString().slice(0, 10);
  let date = opts.date ?? j.date;
  if (isLocked(date, settings.lock_date)) {
    if (opts.date) throw new BooksError('period_locked', 409, { lockDate: settings.lock_date });
    date = today;
  }
  const run = async (tdb: Db) => {
    const id = await writeJournal(
      tdb,
      ws,
      person,
      { date, memo: opts.memo ?? `Reversal of #${j.number}${j.memo ? `: ${j.memo}` : ''}`, sourceType: opts.sourceType ?? 'reversal', reversalOf: j.id },
      normalizeLines(lines.map((l) => ({ accountId: l.account_id, debit: Number(l.credit), credit: Number(l.debit), contactId: l.contact_id, taxRateId: l.tax_rate_id, description: l.description }))),
    );
    // Marca con compare-and-set: dos reversas a la vez, una pierde.
    const res = await tdb.prepare('UPDATE books_journals SET reversed_by = ? WHERE id = ? AND reversed_by IS NULL').run(id, j.id);
    if (!res.changes) throw new BooksError('already_reversed', 409);
    return id;
  };
  if (isLocked(date, settings.lock_date)) throw new BooksError('period_locked', 409);
  return opts.db ? run(opts.db) : inTransaction(run);
}

export async function reverseManualJournal(actor: BooksActor, journalId: string, date?: string): Promise<JournalDto> {
  assertCan(actor, 'accounting.write');
  const j = await getJournal(actor.ws, journalId);
  if (!j) throw new BooksError('not_found', 404);
  if (j.sourceType !== 'manual') throw new BooksError('reverse_from_document', 409);
  const id = await reverseJournal(actor.ws, actor.person, journalId, { date });
  await audit(actor, 'journal.reverse', 'journal', journalId, `#${j.number}`);
  return (await getJournal(actor.ws, id))!;
}

/** Atajo para armar asientos automáticos por clave de cuenta. */
export async function keyAccounts<K extends SystemKey>(ws: string, keys: readonly K[]): Promise<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const k of keys) out[k] = (await accountByKey(ws, k)).id;
  return out;
}

/**
 * Reparte la diferencia de redondeo de una conversión de moneda en la línea
 * más grande del lado que corresponda, para que el asiento convertido siga
 * balanceando (cada línea se convierte y redondea por separado).
 */
export function balanceRounding(lines: JournalLineInput[], fxAccountId: string): JournalLineInput[] {
  const n = normalizeLines(lines);
  const d = n.reduce((s, l) => s + (l.debit ?? 0), 0);
  const c = n.reduce((s, l) => s + (l.credit ?? 0), 0);
  const diff = d - c;
  if (diff === 0) return n;
  return [...n, diff > 0 ? { accountId: fxAccountId, credit: diff, description: 'Rounding' } : { accountId: fxAccountId, debit: -diff, description: 'Rounding' }];
}

