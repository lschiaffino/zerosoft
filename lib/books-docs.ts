/**
 * Books: facturas, notas de crédito y facturas de proveedor (bills), con sus
 * cobros y pagos. Server-only.
 *
 * Ciclo: borrador (se edita y se borra) → aprobar: toma número de la serie,
 * genera el asiento y queda inmutable → cobros parciales o totales → pagada.
 * Vencida la marca el cron. Para corregir: nota de crédito o anular (solo sin
 * cobros aplicados; el asiento se revierte). Documento, número y asiento se
 * escriben en una misma transacción.
 */
import { getDb, type Db } from './db';
import {
  accountByKey,
  assertCan,
  audit,
  ensureBooks,
  getAccount,
  getContactRow,
  getItemRow,
  getSeries,
  getTaxRate,
  defaultSeries,
  moveStock,
  type ContactRow,
  type SettingsRow,
} from './books';
import { balanceRounding, inTransaction, keyAccounts, postJournal, reverseJournal, type JournalLineInput } from './books-ledger';
import { BooksError, clean, likeEsc, newId, newToken, nowDb, numberLabel, parseJson, type BooksActor, type DocStatus, type DocType, DOC_TYPES, type PaymentMethod, PAYMENT_METHODS } from './books-schema';
import { addDays, convert, CURRENCY_RE, docTotals, isValidDate, normalizeQuantity, normalizeRate, parseAmount, todayIso } from './books-money';
import { arInvoiceLetter } from './books-taxid';

export interface DocRow {
  id: string;
  workspace_id: string;
  doc_type: DocType;
  status: DocStatus;
  contact_id: string | null;
  series_id: string | null;
  number: number | null;
  number_label: string;
  reference: string;
  issue_date: string;
  due_date: string | null;
  terms_days: number | null;
  currency: string;
  fx_rate: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  paid_total: number;
  credited_total: number;
  notes: string;
  public_token: string | null;
  public_revoked: number;
  sent_at: string | null;
  viewed_at: string | null;
  posted_at: string | null;
  voided_at: string | null;
  journal_id: string | null;
  credit_for_id: string | null;
  recurring_id: string | null;
  quote_id: string | null;
  shop_order_id: string | null;
  po_id: string | null;
  payment_session: string | null;
  einvoice_status: string | null;
  einvoice_data: string;
  last_reminder_at: string | null;
  reminder_count: number;
  overdue_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LineRow {
  id: string;
  doc_id: string;
  position: number;
  item_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount_bps: number;
  tax_rate_id: string | null;
  tax_bps: number;
  account_id: string | null;
  gross: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
}

export interface LineInputDto {
  itemId?: string | null;
  description?: string;
  quantity?: number;
  /** Unidades mínimas (número entero) o texto decimal ("1500.50"). */
  unitPrice?: number | string;
  discountBps?: number;
  taxRateId?: string | null;
  accountId?: string | null;
}

export interface DocInput {
  docType?: DocType;
  contactId?: string | null;
  seriesId?: string | null;
  issueDate?: string;
  dueDate?: string | null;
  termsDays?: number | null;
  currency?: string;
  fxRate?: string | number;
  reference?: string;
  notes?: string;
  lines?: LineInputDto[];
}

export const MAX_LINES = 200;
/** Tope del precio unitario y del total de una línea (unidades mínimas). */
export const MAX_LINE_AMOUNT = 10_000_000_000_000;

/** Saldo pendiente en la moneda del documento. */
export function amountDue(d: Pick<DocRow, 'total' | 'paid_total' | 'credited_total' | 'status'>): number {
  if (d.status === 'draft' || d.status === 'void') return 0;
  return Math.max(0, d.total - d.paid_total - d.credited_total);
}

/**
 * Estado según lo cobrado (sin tocar draft ni void). "Vencida" la pone solo
 * el cron (markOverdue), que es el que avisa y dispara el evento: acá una
 * vencida con saldo sigue vencida y el resto queda emitida o parcial.
 */
export function statusFor(d: Pick<DocRow, 'total' | 'paid_total' | 'credited_total' | 'status'>): DocStatus {
  if (d.status === 'draft' || d.status === 'void') return d.status;
  const due = Math.max(0, d.total - d.paid_total - d.credited_total);
  if (due === 0) return 'paid';
  if (d.status === 'overdue') return 'overdue';
  return d.paid_total + d.credited_total > 0 ? 'partial' : 'sent';
}

// ---------- Lectura ----------

export interface DocLineDto {
  id: string;
  itemId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountBps: number;
  taxRateId: string | null;
  taxBps: number;
  accountId: string | null;
  net: number;
  tax: number;
  total: number;
}

export interface PaymentDto {
  id: string;
  amount: number;
  date: string;
  method: string;
  accountId: string;
  reference: string;
  journalId: string | null;
  createdAt: string;
}

export interface DocDto {
  id: string;
  docType: DocType;
  status: DocStatus;
  contactId: string | null;
  contactName: string;
  contactEmail: string;
  seriesId: string | null;
  number: number | null;
  numberLabel: string;
  reference: string;
  issueDate: string;
  dueDate: string | null;
  termsDays: number | null;
  currency: string;
  fxRate: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  paidTotal: number;
  creditedTotal: number;
  amountDue: number;
  notes: string;
  publicToken: string | null;
  publicRevoked: boolean;
  sentAt: string | null;
  viewedAt: string | null;
  postedAt: string | null;
  voidedAt: string | null;
  journalId: string | null;
  creditForId: string | null;
  recurringId: string | null;
  quoteId: string | null;
  shopOrderId: string | null;
  poId: string | null;
  einvoice: { status: string | null; data: Record<string, unknown> };
  reminderCount: number;
  lastReminderAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: DocLineDto[];
  payments: PaymentDto[];
  creditNotes: Array<{ id: string; numberLabel: string; total: number; status: DocStatus }>;
  taxBreakdown: Array<{ taxBps: number; net: number; tax: number }>;
}

/** Fila resumida para listas. */
export interface DocSummary {
  id: string;
  docType: DocType;
  status: DocStatus;
  numberLabel: string;
  reference: string;
  contactId: string | null;
  contactName: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  total: number;
  amountDue: number;
  sentAt: string | null;
  updatedAt: string;
}

export async function getDocRow(ws: string, id: string, db: Db = getDb()): Promise<DocRow | null> {
  return ((await db.prepare('SELECT * FROM books_documents WHERE id = ? AND workspace_id = ?').get(id, ws)) as DocRow | undefined) ?? null;
}

export async function docLines(docId: string, db: Db = getDb()): Promise<LineRow[]> {
  return (await db.prepare('SELECT * FROM books_lines WHERE doc_id = ? ORDER BY position ASC').all(docId)) as LineRow[];
}

/** El rol ve este tipo de documento (sales solo facturas y notas de crédito). */
export function docArea(t: DocType): 'invoices' | 'bills' {
  return t === 'bill' ? 'bills' : 'invoices';
}

export async function getDocument(ws: string, id: string): Promise<DocDto | null> {
  const d = await getDocRow(ws, id);
  if (!d) return null;
  const db = getDb();
  const [lines, payments, contact, cns] = await Promise.all([
    docLines(id),
    db.prepare('SELECT * FROM books_payments WHERE doc_id = ? ORDER BY date ASC, created_at ASC').all(id) as Promise<Array<Record<string, unknown>>>,
    getContactRow(ws, d.contact_id),
    db.prepare("SELECT id, number_label, total, status FROM books_documents WHERE credit_for_id = ? AND workspace_id = ? AND status != 'draft' ORDER BY created_at").all(id, ws) as Promise<
      Array<{ id: string; number_label: string; total: number; status: DocStatus }>
    >,
  ]);
  const totals = docTotals(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unit_price, discountBps: l.discount_bps, taxBps: l.tax_bps })));
  return {
    id: d.id,
    docType: d.doc_type,
    status: d.status,
    contactId: d.contact_id,
    contactName: contact?.name ?? '',
    contactEmail: contact?.email ?? '',
    seriesId: d.series_id,
    number: d.number,
    numberLabel: d.number_label,
    reference: d.reference,
    issueDate: d.issue_date,
    dueDate: d.due_date,
    termsDays: d.terms_days,
    currency: d.currency,
    fxRate: d.fx_rate,
    subtotal: d.subtotal,
    discountTotal: d.discount_total,
    taxTotal: d.tax_total,
    total: d.total,
    paidTotal: d.paid_total,
    creditedTotal: d.credited_total,
    amountDue: amountDue(d),
    notes: d.notes,
    publicToken: d.public_revoked ? null : d.public_token,
    publicRevoked: d.public_revoked === 1,
    sentAt: d.sent_at,
    viewedAt: d.viewed_at,
    postedAt: d.posted_at,
    voidedAt: d.voided_at,
    journalId: d.journal_id,
    creditForId: d.credit_for_id,
    recurringId: d.recurring_id,
    quoteId: d.quote_id,
    shopOrderId: d.shop_order_id,
    poId: d.po_id,
    einvoice: { status: d.einvoice_status, data: parseJson<Record<string, unknown>>(d.einvoice_data, {}) },
    reminderCount: d.reminder_count,
    lastReminderAt: d.last_reminder_at,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    lines: lines.map((l) => ({
      id: l.id,
      itemId: l.item_id,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      discountBps: l.discount_bps,
      taxRateId: l.tax_rate_id,
      taxBps: l.tax_bps,
      accountId: l.account_id,
      net: l.net,
      tax: l.tax,
      total: l.total,
    })),
    payments: payments.map((p) => ({
      id: String(p.id),
      amount: Number(p.amount),
      date: String(p.date),
      method: String(p.method),
      accountId: String(p.account_id),
      reference: String(p.reference ?? ''),
      journalId: (p.journal_id as string) ?? null,
      createdAt: String(p.created_at),
    })),
    creditNotes: cns.map((c) => ({ id: c.id, numberLabel: c.number_label, total: Number(c.total), status: c.status })),
    taxBreakdown: totals.byRate,
  };
}

export async function listDocuments(
  ws: string,
  opts: { docType?: DocType | DocType[]; status?: string; q?: string; contactId?: string; from?: string; to?: string; limit?: number } = {},
): Promise<{ items: DocSummary[]; total: number }> {
  await ensureBooks(ws);
  const where = ['d.workspace_id = ?'];
  const args: Array<string | number> = [ws];
  const types = opts.docType ? (Array.isArray(opts.docType) ? opts.docType : [opts.docType]) : null;
  // Una lista vacía no es "todos": no devuelve nada (nadie ve compras por un filtro vacío).
  if (types && !types.length) return { items: [], total: 0 };
  if (types?.length) {
    where.push(`d.doc_type IN (${types.map(() => '?').join(',')})`);
    args.push(...types);
  }
  if (opts.status === 'open') where.push("d.status IN ('sent','partial','overdue')");
  else if (opts.status) (where.push('d.status = ?'), args.push(opts.status));
  if (opts.contactId) (where.push('d.contact_id = ?'), args.push(opts.contactId));
  if (opts.from) (where.push('d.issue_date >= ?'), args.push(opts.from));
  if (opts.to) (where.push('d.issue_date <= ?'), args.push(opts.to));
  if (opts.q?.trim()) {
    const l = likeEsc(opts.q.trim());
    where.push("(d.number_label LIKE ? ESCAPE '\\' OR d.reference LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')");
    args.push(l, l, l);
  }
  const base = `FROM books_documents d LEFT JOIN books_contacts c ON c.id = d.contact_id WHERE ${where.join(' AND ')}`;
  const count = (await getDb().prepare(`SELECT COUNT(*) AS n ${base}`).get(...args)) as { n: number };
  const rows = (await getDb()
    .prepare(`SELECT d.*, c.name AS contact_name ${base} ORDER BY d.issue_date DESC, d.created_at DESC LIMIT ?`)
    .all(...args, Math.min(opts.limit ?? 200, 1000))) as Array<DocRow & { contact_name: string | null }>;
  return {
    total: Number(count.n),
    items: rows.map((d) => ({
      id: d.id,
      docType: d.doc_type,
      status: d.status,
      numberLabel: d.number_label,
      reference: d.reference,
      contactId: d.contact_id,
      contactName: d.contact_name ?? '',
      issueDate: d.issue_date,
      dueDate: d.due_date,
      currency: d.currency,
      total: d.total,
      amountDue: amountDue(d),
      sentAt: d.sent_at,
      updatedAt: d.updated_at,
    })),
  };
}

// ---------- Borradores ----------

interface ResolvedLine {
  itemId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountBps: number;
  taxRateId: string | null;
  taxBps: number;
  accountId: string | null;
}

async function resolveLines(ws: string, docType: DocType, currency: string, lines: LineInputDto[], opts: { allowNegative?: boolean } = {}): Promise<ResolvedLine[]> {
  if (!Array.isArray(lines) || lines.length > MAX_LINES) throw new BooksError('too_many_lines');
  const out: ResolvedLine[] = [];
  for (const l of lines) {
    const item = l.itemId ? await getItemRow(ws, l.itemId) : null;
    if (l.itemId && !item) throw new BooksError('invalid_item');
    const description = clean(l.description ?? item?.name ?? '', 1000);
    const quantity = normalizeQuantity(Number(l.quantity ?? 1));
    if (!(quantity > 0) || quantity > 1e9) throw new BooksError('invalid_quantity');
    let unitPrice: number;
    if (l.unitPrice === undefined || l.unitPrice === '') unitPrice = item ? (docType === 'bill' ? item.cost : item.price) : 0;
    else if (typeof l.unitPrice === 'number') unitPrice = Math.trunc(l.unitPrice);
    else {
      const p = parseAmount(l.unitPrice, currency);
      if (p == null) throw new BooksError('invalid_amount');
      unitPrice = p;
    }
    // Tope por línea: 10^13 unidades mínimas (diez billones con centavos) para que nada se acerque al límite de un entero seguro.
    if ((unitPrice < 0 && !opts.allowNegative) || !Number.isSafeInteger(unitPrice) || Math.abs(unitPrice) > MAX_LINE_AMOUNT) throw new BooksError('invalid_amount');
    const discountBps = Math.trunc(Number(l.discountBps ?? 0));
    if (!(discountBps >= 0 && discountBps <= 10_000)) throw new BooksError('invalid_discount');
    const taxRateId = l.taxRateId !== undefined ? l.taxRateId : (item?.tax_rate_id ?? null);
    const tax = taxRateId ? await getTaxRate(ws, taxRateId) : null;
    if (taxRateId && !tax) throw new BooksError('invalid_tax_rate');
    const accountId = l.accountId ?? (docType === 'bill' ? item?.purchase_account_id : item?.sales_account_id) ?? null;
    if (accountId && !(await getAccount(ws, accountId))) throw new BooksError('invalid_account');
    if (!description && !item) continue;
    if (Math.abs(quantity * unitPrice) > MAX_LINE_AMOUNT) throw new BooksError('invalid_amount');
    out.push({ itemId: item?.id ?? null, description, quantity, unitPrice, discountBps, taxRateId: tax?.id ?? null, taxBps: tax?.rate_bps ?? 0, accountId });
  }
  return out;
}

async function writeLines(db: Db, ws: string, docId: string, lines: ResolvedLine[]): Promise<ReturnType<typeof docTotals>> {
  const totals = docTotals(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountBps: l.discountBps, taxBps: l.taxBps })));
  await db.prepare('DELETE FROM books_lines WHERE doc_id = ?').run(docId);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const a = totals.lines[i];
    await db
      .prepare(
        `INSERT INTO books_lines (id, doc_id, workspace_id, position, item_id, description, quantity, unit_price, discount_bps, tax_rate_id, tax_bps, account_id, gross, discount, net, tax, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(newId('ln'), docId, ws, i, l.itemId, l.description, l.quantity, l.unitPrice, l.discountBps, l.taxRateId, l.taxBps, l.accountId, a.gross, a.discount, a.net, a.tax, a.total);
  }
  return totals;
}

function docFields(s: SettingsRow, input: DocInput, cur: DocRow | null, contact: ContactRow | null) {
  const issueDate = input.issueDate ?? cur?.issue_date ?? todayIso();
  if (!isValidDate(issueDate)) throw new BooksError('invalid_date');
  const currency = (input.currency ?? cur?.currency ?? contact?.currency ?? s.base_currency).toUpperCase();
  if (!CURRENCY_RE.test(currency)) throw new BooksError('invalid_currency');
  let fx = currency === s.base_currency ? '1' : normalizeRate(input.fxRate ?? (cur && cur.currency === currency ? cur.fx_rate : undefined));
  if (!fx) throw new BooksError('fx_rate_required');
  if (currency === s.base_currency) fx = '1';
  const termsDays =
    input.termsDays !== undefined ? (input.termsDays === null ? null : Math.max(0, Math.min(365, Math.trunc(Number(input.termsDays))))) : (cur?.terms_days ?? contact?.terms_days ?? s.terms_days);
  let dueDate = input.dueDate !== undefined ? input.dueDate : (cur?.due_date ?? null);
  if (input.dueDate === undefined && (input.termsDays !== undefined || input.issueDate !== undefined || !cur)) dueDate = termsDays != null ? addDays(issueDate, termsDays) : dueDate;
  if (dueDate && (!isValidDate(dueDate) || dueDate < issueDate)) throw new BooksError('invalid_due_date');
  return {
    issueDate,
    currency,
    fx,
    termsDays,
    dueDate,
    reference: input.reference !== undefined ? clean(input.reference, 120) : (cur?.reference ?? ''),
    notes: input.notes !== undefined ? clean(input.notes, 4000) : (cur?.notes ?? ''),
  };
}

async function checkContact(ws: string, docType: DocType, contactId: string | null | undefined): Promise<ContactRow | null> {
  if (!contactId) return null;
  const c = await getContactRow(ws, contactId);
  if (!c) throw new BooksError('invalid_contact');
  if (docType === 'bill' ? c.kind === 'customer' : c.kind === 'supplier') {
    // Se acepta igual (un proveedor que también compra), pero se marca como ambos.
    await getDb().prepare("UPDATE books_contacts SET kind = 'both', updated_at = ? WHERE id = ?").run(nowDb(), c.id);
  }
  return c;
}

export async function createDraft(
  actor: BooksActor,
  input: DocInput,
  extra: Partial<Pick<DocRow, 'recurring_id' | 'quote_id' | 'shop_order_id' | 'po_id' | 'credit_for_id'>> = {},
  opts: { allowNegativeLines?: boolean } = {},
): Promise<DocDto> {
  const docType = input.docType ?? 'invoice';
  if (!(DOC_TYPES as readonly string[]).includes(docType)) throw new BooksError('invalid_doc_type');
  assertCan(actor, `${docArea(docType)}.write`);
  const s = await ensureBooks(actor.ws);
  const contact = await checkContact(actor.ws, docType, input.contactId);
  const f = docFields(s, input, null, contact);
  const series = docType === 'bill' ? null : input.seriesId ? await getSeries(actor.ws, input.seriesId) : null;
  if (input.seriesId && (!series || series.doc_type !== docType)) throw new BooksError('invalid_series');
  const lines = await resolveLines(actor.ws, docType, f.currency, input.lines ?? [], { allowNegative: opts.allowNegativeLines });
  const id = newId(docType === 'bill' ? 'bil' : docType === 'credit_note' ? 'cn' : 'inv');
  const ts = nowDb();
  await inTransaction(async (db) => {
    await db
      .prepare(
        `INSERT INTO books_documents (id, workspace_id, doc_type, status, contact_id, series_id, reference, issue_date, due_date, terms_days, currency, fx_rate, notes,
           recurring_id, quote_id, shop_order_id, po_id, credit_for_id, created_by, created_at, updated_at, number_label)
         VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        actor.ws,
        docType,
        contact?.id ?? null,
        series?.id ?? null,
        f.reference,
        f.issueDate,
        f.dueDate,
        f.termsDays,
        f.currency,
        f.fx,
        f.notes,
        extra.recurring_id ?? null,
        extra.quote_id ?? null,
        extra.shop_order_id ?? null,
        extra.po_id ?? null,
        extra.credit_for_id ?? null,
        actor.person,
        ts,
        ts,
        docType === 'bill' ? f.reference : '',
      );
    const totals = await writeLines(db, actor.ws, id, lines);
    await db
      .prepare('UPDATE books_documents SET subtotal = ?, discount_total = ?, tax_total = ?, total = ? WHERE id = ?')
      .run(totals.subtotal, totals.discountTotal, totals.taxTotal, totals.total, id);
  });
  await audit(actor, 'doc.create', docType, id, f.reference);
  return (await getDocument(actor.ws, id))!;
}

export async function updateDraft(actor: BooksActor, id: string, input: DocInput): Promise<DocDto> {
  const cur = await getDocRow(actor.ws, id);
  if (!cur) throw new BooksError('not_found', 404);
  assertCan(actor, `${docArea(cur.doc_type)}.write`);
  if (cur.status !== 'draft') {
    // Emitido: solo cambian la referencia interna y las notas (no los importes ni la fecha).
    const onlyMeta = Object.keys(input).every((k) => k === 'reference' || k === 'notes');
    if (!onlyMeta || cur.doc_type === 'bill') throw new BooksError('document_posted', 409);
    await getDb()
      .prepare('UPDATE books_documents SET reference = ?, notes = ?, updated_at = ? WHERE id = ?')
      .run(input.reference !== undefined ? clean(input.reference, 120) : cur.reference, input.notes !== undefined ? clean(input.notes, 4000) : cur.notes, nowDb(), id);
    await audit(actor, 'doc.update_meta', cur.doc_type, id, '');
    return (await getDocument(actor.ws, id))!;
  }
  const s = await ensureBooks(actor.ws);
  const contact = input.contactId !== undefined ? await checkContact(actor.ws, cur.doc_type, input.contactId) : await getContactRow(actor.ws, cur.contact_id);
  const f = docFields(s, input, cur, contact);
  let seriesId = cur.series_id;
  if (input.seriesId !== undefined && cur.doc_type !== 'bill') {
    const series = input.seriesId ? await getSeries(actor.ws, input.seriesId) : null;
    if (input.seriesId && (!series || series.doc_type !== cur.doc_type)) throw new BooksError('invalid_series');
    seriesId = series?.id ?? null;
  }
  const lines = input.lines ? await resolveLines(actor.ws, cur.doc_type, f.currency, input.lines) : null;
  await inTransaction(async (db) => {
    const res = await db
      .prepare(
        `UPDATE books_documents SET contact_id = ?, series_id = ?, reference = ?, issue_date = ?, due_date = ?, terms_days = ?, currency = ?, fx_rate = ?, notes = ?, updated_at = ?,
         number_label = CASE WHEN doc_type = 'bill' THEN ? ELSE number_label END
         WHERE id = ? AND status = 'draft'`,
      )
      .run(contact?.id ?? null, seriesId, f.reference, f.issueDate, f.dueDate, f.termsDays, f.currency, f.fx, f.notes, nowDb(), f.reference, id);
    if (!res.changes) throw new BooksError('document_posted', 409);
    if (lines) {
      const totals = await writeLines(db, actor.ws, id, lines);
      await db
        .prepare('UPDATE books_documents SET subtotal = ?, discount_total = ?, tax_total = ?, total = ? WHERE id = ?')
        .run(totals.subtotal, totals.discountTotal, totals.taxTotal, totals.total, id);
    } else if (input.currency !== undefined && input.currency !== cur.currency) {
      // Cambiar la moneda sin mandar las líneas no recalcula precios: se piden las líneas.
      throw new BooksError('lines_required', 400);
    }
  });
  await audit(actor, 'doc.update', cur.doc_type, id, '');
  return (await getDocument(actor.ws, id))!;
}

export async function deleteDraft(actor: BooksActor, id: string): Promise<void> {
  const cur = await getDocRow(actor.ws, id);
  if (!cur) throw new BooksError('not_found', 404);
  assertCan(actor, `${docArea(cur.doc_type)}.write`);
  if (cur.status !== 'draft') throw new BooksError('document_posted', 409);
  const res = await getDb().prepare("DELETE FROM books_documents WHERE id = ? AND workspace_id = ? AND status = 'draft'").run(id, actor.ws);
  if (!res.changes) throw new BooksError('document_posted', 409);
  await audit(actor, 'doc.delete', cur.doc_type, id, cur.reference);
}

// ---------- Aprobar (emitir) ----------

/** Líneas del asiento de un documento, en moneda base. */
export async function documentJournalLines(ws: string, d: DocRow, lines: LineRow[], s: SettingsRow): Promise<JournalLineInput[]> {
  const k = await keyAccounts(ws, ['ar', 'ap', 'tax_out', 'tax_in', 'sales', 'services', 'expense', 'cogs', 'fx'] as const);
  const base = (minor: number) => convert(minor, d.currency, d.fx_rate, s.base_currency);
  const out: JournalLineInput[] = [];
  const contactId = d.contact_id;
  const sign = d.doc_type === 'credit_note' ? -1 : 1;
  if (d.doc_type === 'bill') {
    for (const l of lines) {
      const item = l.item_id ? await getItemRow(ws, l.item_id) : null;
      const acc = l.account_id ?? item?.purchase_account_id ?? (item?.kind === 'product' ? k.cogs : k.expense);
      out.push({ accountId: acc, debit: base(l.net), contactId, description: l.description.slice(0, 200) });
      if (l.tax) out.push({ accountId: k.tax_in, debit: base(l.tax), contactId, taxRateId: l.tax_rate_id, description: 'Tax' });
    }
    const credits = out.reduce((s2, l) => s2 + (l.debit ?? 0), 0);
    out.push({ accountId: k.ap, credit: credits, contactId, description: d.number_label || d.reference });
    return balanceRounding(out, k.fx);
  }
  for (const l of lines) {
    const item = l.item_id ? await getItemRow(ws, l.item_id) : null;
    const acc = l.account_id ?? item?.sales_account_id ?? (item?.kind === 'product' ? k.sales : item ? k.services : k.sales);
    out.push({ accountId: acc, credit: sign * base(l.net), contactId, description: l.description.slice(0, 200) });
    if (l.tax) out.push({ accountId: k.tax_out, credit: sign * base(l.tax), contactId, taxRateId: l.tax_rate_id, description: 'Tax' });
  }
  const credit = out.reduce((s2, l) => s2 + (l.credit ?? 0), 0);
  out.push({ accountId: k.ar, debit: credit, contactId, description: d.number_label });
  return balanceRounding(out, k.fx);
}

async function pickSeries(ws: string, d: DocRow, s: SettingsRow, contact: ContactRow | null) {
  if (d.series_id) return getSeries(ws, d.series_id);
  const letter = s.country === 'AR' ? arInvoiceLetter(s.tax_condition, contact?.tax_condition || 'cf') : undefined;
  return defaultSeries(ws, d.doc_type, letter);
}

/**
 * Aprueba (emite) un borrador: número de la serie (compare-and-set), asiento
 * balanceado, estado "sent" y link público, todo en una transacción. Las
 * facturas con ítems con stock lo descuentan; las de proveedor sin orden de
 * compra lo suman. Una nota de crédito se aplica a su factura.
 */
export async function approveDocument(actor: BooksActor, id: string, opts: { system?: boolean } = {}): Promise<DocDto> {
  const d = await getDocRow(actor.ws, id);
  if (!d) throw new BooksError('not_found', 404);
  if (!opts.system) assertCan(actor, `${docArea(d.doc_type)}.write`);
  if (d.status !== 'draft') throw new BooksError('document_posted', 409);
  const s = await ensureBooks(actor.ws);
  const lines = await docLines(id);
  if (!lines.length || d.total <= 0) throw new BooksError('empty_document');
  const contact = await getContactRow(actor.ws, d.contact_id);
  if (!contact) throw new BooksError('contact_required');
  if (d.doc_type === 'bill' && !d.reference) throw new BooksError('supplier_number_required');
  let creditFor: DocRow | null = null;
  if (d.doc_type === 'credit_note' && d.credit_for_id) {
    creditFor = await getDocRow(actor.ws, d.credit_for_id);
    if (!creditFor || creditFor.status === 'draft' || creditFor.status === 'void') throw new BooksError('invalid_credit_target', 409);
    if (creditFor.currency !== d.currency) throw new BooksError('currency_mismatch', 409);
    // Las notas emitidas contra una factura no suman más que su total (aunque la factura ya esté cobrada).
    const already = await creditedSoFar(actor.ws, creditFor.id);
    if (already >= creditFor.total) throw new BooksError('already_credited', 409);
    if (d.total > creditFor.total - already) throw new BooksError('credit_exceeds_invoice', 409, { max: creditFor.total - already });
  }
  const series = d.doc_type === 'bill' ? null : await pickSeries(actor.ws, d, s, contact);
  if (d.doc_type !== 'bill' && !series) throw new BooksError('series_required', 409);
  const jLines = await documentJournalLines(actor.ws, d, lines, s);
  const ts = nowDb();
  await inTransaction(async (db) => {
    let number: number | null = null;
    let label = d.number_label;
    if (series) {
      for (let i = 0; i < 5 && number == null; i++) {
        const cur = (await db.prepare('SELECT next_number FROM books_series WHERE id = ?').get(series.id)) as { next_number: number };
        const n = Number(cur.next_number);
        const res = await db.prepare('UPDATE books_series SET next_number = ? WHERE id = ? AND next_number = ?').run(n + 1, series.id, n);
        if (res.changes) number = n;
      }
      if (number == null) throw new BooksError('conflict', 409);
      label = numberLabel(d.doc_type, series.letter, series.point_of_sale, number, s.country);
    }
    const journalId = await postJournal(actor.ws, actor.person, { date: d.issue_date, memo: `${label}${contact ? ` · ${contact.name}` : ''}`, sourceType: d.doc_type, sourceId: d.id, lines: jLines }, { db });
    const res = await db
      .prepare(
        `UPDATE books_documents SET status = 'sent', series_id = ?, number = ?, number_label = ?, posted_at = ?, journal_id = ?, public_token = COALESCE(public_token, ?), updated_at = ?
         WHERE id = ? AND status = 'draft'`,
      )
      .run(series?.id ?? null, number, label, ts, journalId, d.doc_type === 'bill' ? null : newToken(), ts, d.id);
    if (!res.changes) throw new BooksError('document_posted', 409);
    if (creditFor) {
      // La nota se aplica a la factura hasta su saldo; el resto queda como crédito a favor.
      const fresh = (await getDocRow(actor.ws, creditFor.id, db))!;
      const apply = Math.min(d.total, amountDue(fresh));
      if (apply > 0) {
        const upd = await db
          .prepare('UPDATE books_documents SET credited_total = credited_total + ?, updated_at = ? WHERE id = ? AND credited_total = ? AND paid_total = ?')
          .run(apply, ts, fresh.id, fresh.credited_total, fresh.paid_total);
        if (!upd.changes) throw new BooksError('conflict', 409);
        await db.prepare('UPDATE books_documents SET paid_total = ? WHERE id = ?').run(apply, d.id);
        const after = (await getDocRow(actor.ws, fresh.id, db))!;
        await db.prepare('UPDATE books_documents SET status = ? WHERE id = ?').run(statusFor(after), fresh.id);
      }
      const cn = (await getDocRow(actor.ws, d.id, db))!;
      await db.prepare('UPDATE books_documents SET status = ? WHERE id = ?').run(statusFor(cn), d.id);
    } else {
      const fresh = (await getDocRow(actor.ws, d.id, db))!;
      const st = statusFor(fresh);
      if (st !== 'sent') await db.prepare('UPDATE books_documents SET status = ? WHERE id = ?').run(st, d.id);
    }
  });
  // Stock: fuera de la transacción (Shop tiene su propio compare-and-set).
  for (const l of lines) {
    if (!l.item_id) continue;
    const delta = d.doc_type === 'invoice' ? -l.quantity : d.doc_type === 'bill' && !d.po_id ? l.quantity : 0;
    if (delta) await moveStock(actor, l.item_id, delta, d.doc_type === 'invoice' ? 'sale' : 'purchase', { type: d.doc_type, id: d.id }).catch((err) => console.error('[books] stock', err instanceof Error ? err.message : err));
  }
  await audit(actor, 'doc.approve', d.doc_type, d.id, '');
  return (await getDocument(actor.ws, id))!;
}

/** Anula un documento emitido sin cobros ni notas aplicadas: revierte su asiento (y el stock). */
export async function voidDocument(actor: BooksActor, id: string, reason = ''): Promise<DocDto> {
  const d = await getDocRow(actor.ws, id);
  if (!d) throw new BooksError('not_found', 404);
  assertCan(actor, `${docArea(d.doc_type)}.write`);
  // Anular revierte un asiento: solo el rol contable (sales emite y cobra, no anula).
  if (actor.role !== 'accountant') throw new BooksError('forbidden', 403, { need: 'accountant' });
  if (d.status === 'draft') throw new BooksError('delete_draft_instead', 409);
  if (d.status === 'void') throw new BooksError('already_void', 409);
  if (d.doc_type !== 'credit_note' && (d.paid_total > 0 || d.credited_total > 0)) throw new BooksError('has_payments', 409);
  if (d.einvoice_status === 'authorized') throw new BooksError('einvoice_authorized_use_credit_note', 409);
  const ts = nowDb();
  await inTransaction(async (db) => {
    // La reversa va con la fecha de la anulación: un período ya presentado no cambia.
    if (d.journal_id) await reverseJournal(actor.ws, actor.person, d.journal_id, { date: todayIso(), sourceType: 'void', memo: `Void ${d.number_label}${reason ? `: ${clean(reason, 120)}` : ''}`, db });
    // Nota de crédito anulada: devuelve el saldo a la factura que había reducido.
    if (d.doc_type === 'credit_note' && d.credit_for_id && d.paid_total > 0) {
      const inv = (await getDocRow(actor.ws, d.credit_for_id, db))!;
      await db.prepare('UPDATE books_documents SET credited_total = MAX(0, credited_total - ?), updated_at = ? WHERE id = ?').run(d.paid_total, ts, inv.id);
      const after = (await getDocRow(actor.ws, inv.id, db))!;
      await db.prepare('UPDATE books_documents SET status = ? WHERE id = ?').run(statusFor(after), inv.id);
    }
    const res = await db.prepare("UPDATE books_documents SET status = 'void', voided_at = ?, updated_at = ? WHERE id = ? AND status != 'void'").run(ts, ts, id);
    if (!res.changes) throw new BooksError('already_void', 409);
  });
  for (const l of await docLines(id)) {
    if (!l.item_id) continue;
    const delta = d.doc_type === 'invoice' ? l.quantity : d.doc_type === 'bill' && !d.po_id ? -l.quantity : 0;
    if (delta) await moveStock(actor, l.item_id, delta, 'void', { type: d.doc_type, id: d.id }).catch(() => undefined);
  }
  await audit(actor, 'doc.void', d.doc_type, id, clean(reason, 200));
  return (await getDocument(actor.ws, id))!;
}

/** Total de las notas de crédito emitidas (no anuladas) contra una factura. */
async function creditedSoFar(ws: string, invoiceId: string): Promise<number> {
  const r = (await getDb()
    .prepare("SELECT COALESCE(SUM(total), 0) AS v FROM books_documents WHERE workspace_id = ? AND credit_for_id = ? AND doc_type = 'credit_note' AND status NOT IN ('draft','void')")
    .get(ws, invoiceId)) as { v: number };
  return Number(r.v);
}

/** Borrador de nota de crédito por el total (o las líneas pedidas) de una factura emitida. */
export async function createCreditNote(actor: BooksActor, invoiceId: string, input: { lines?: LineInputDto[]; reason?: string } = {}): Promise<DocDto> {
  assertCan(actor, 'invoices.write');
  const inv = await getDocRow(actor.ws, invoiceId);
  if (!inv || inv.doc_type !== 'invoice') throw new BooksError('not_found', 404);
  if (inv.status === 'draft' || inv.status === 'void') throw new BooksError('invalid_status', 409);
  if ((await creditedSoFar(actor.ws, inv.id)) >= inv.total) throw new BooksError('already_credited', 409);
  const lines =
    input.lines ??
    (await docLines(invoiceId)).map((l) => ({ itemId: l.item_id, description: l.description, quantity: l.quantity, unitPrice: l.unit_price, discountBps: l.discount_bps, taxRateId: l.tax_rate_id, accountId: l.account_id }));
  // Misma letra que la factura (AR): NC A para una A.
  const invSeries = await getSeries(actor.ws, inv.series_id);
  const cnSeries = invSeries ? await defaultSeries(actor.ws, 'credit_note', invSeries.letter || undefined) : null;
  return createDraft(
    actor,
    {
      docType: 'credit_note',
      contactId: inv.contact_id,
      seriesId: cnSeries?.id ?? null,
      currency: inv.currency,
      fxRate: inv.fx_rate,
      issueDate: todayIso(),
      termsDays: 0,
      reference: inv.number_label,
      notes: clean(input.reason ?? '', 1000),
      lines,
    },
    { credit_for_id: inv.id },
  );
}

// ---------- Cobros y pagos ----------

export interface PaymentInput {
  amount: number | string;
  date?: string;
  /** Cuenta contable de banco/caja (o cuenta bancaria de Books). */
  accountId?: string;
  bankAccountId?: string;
  method?: PaymentMethod;
  reference?: string;
  /** Tipo de cambio del día del cobro (moneda base por 1 de la del documento). */
  fxRate?: string | number;
  providerRef?: string | null;
  bankTxnId?: string | null;
}

async function paymentAccount(ws: string, input: PaymentInput, method: PaymentMethod): Promise<string> {
  if (input.bankAccountId) {
    const b = (await getDb().prepare('SELECT account_id FROM books_bank_accounts WHERE id = ? AND workspace_id = ?').get(input.bankAccountId, ws)) as { account_id: string } | undefined;
    if (!b) throw new BooksError('invalid_account');
    return b.account_id;
  }
  if (input.accountId) {
    const acc = await getAccount(ws, input.accountId);
    if (!acc || acc.type !== 'asset') throw new BooksError('invalid_account');
    return acc.id;
  }
  if (method === 'stripe' || method === 'mercadopago') return (await accountByKey(ws, 'clearing')).id;
  if (method === 'cash') return (await accountByKey(ws, 'cash')).id;
  return (await accountByKey(ws, 'bank')).id;
}

/**
 * Registra un cobro (factura) o pago (bill): asiento banco contra deudores o
 * proveedores, con la diferencia de cambio si el tipo del día es otro, y el
 * saldo del documento con compare-and-set. `providerRef` (Stripe, Mercado
 * Pago) es único por workspace: el mismo pago dos veces no se registra dos.
 */
export async function recordPayment(actor: BooksActor, docId: string, input: PaymentInput, opts: { system?: boolean } = {}): Promise<{ doc: DocDto; paymentId: string; duplicate?: boolean }> {
  const d = await getDocRow(actor.ws, docId);
  if (!d) throw new BooksError('not_found', 404);
  if (!opts.system) assertCan(actor, d.doc_type === 'bill' ? 'bills.write' : 'invoices.write');
  if (d.doc_type === 'credit_note') throw new BooksError('invalid_doc_type', 409);
  if (!['sent', 'partial', 'overdue'].includes(d.status)) throw new BooksError('invalid_status', 409, { status: d.status });
  if (input.providerRef) {
    const dup = (await getDb().prepare('SELECT id FROM books_payments WHERE workspace_id = ? AND provider_ref = ?').get(actor.ws, input.providerRef)) as { id: string } | undefined;
    if (dup) return { doc: (await getDocument(actor.ws, docId))!, paymentId: dup.id, duplicate: true };
  }
  const s = await ensureBooks(actor.ws);
  const amount = typeof input.amount === 'number' ? Math.trunc(input.amount) : parseAmount(input.amount, d.currency);
  if (amount == null || amount <= 0) throw new BooksError('invalid_amount');
  const due = amountDue(d);
  if (amount > due) throw new BooksError('amount_exceeds_due', 409, { due });
  const date = input.date ?? todayIso();
  if (!isValidDate(date)) throw new BooksError('invalid_date');
  const method: PaymentMethod = input.method && (PAYMENT_METHODS as readonly string[]).includes(input.method) ? input.method : 'bank';
  // sales cobra solo a una cuenta bancaria o caja de Books, no a cualquier cuenta de activo.
  if (!opts.system && actor.role !== 'accountant' && input.accountId && !input.bankAccountId) throw new BooksError('forbidden', 403, { need: 'bank_account' });
  const accountId = await paymentAccount(actor.ws, input, method);
  const payFx = d.currency === s.base_currency ? '1' : (normalizeRate(input.fxRate) ?? d.fx_rate);
  const k = await keyAccounts(actor.ws, ['ar', 'ap', 'fx'] as const);
  const atDoc = convert(amount, d.currency, d.fx_rate, s.base_currency);
  const atPay = convert(amount, d.currency, payFx, s.base_currency);
  const lines: JournalLineInput[] =
    d.doc_type === 'bill'
      ? [
          { accountId: k.ap, debit: atDoc, contactId: d.contact_id },
          { accountId, credit: atPay, contactId: d.contact_id },
          // Pagar más caro (en base) que lo registrado es pérdida de cambio.
          ...(atPay !== atDoc ? [atPay > atDoc ? { accountId: k.fx, debit: atPay - atDoc } : { accountId: k.fx, credit: atDoc - atPay }] : []),
        ]
      : [
          { accountId, debit: atPay, contactId: d.contact_id },
          { accountId: k.ar, credit: atDoc, contactId: d.contact_id },
          ...(atPay !== atDoc ? [atPay > atDoc ? { accountId: k.fx, credit: atPay - atDoc } : { accountId: k.fx, debit: atDoc - atPay }] : []),
        ];
  const paymentId = newId('pay');
  const ts = nowDb();
  try {
    await inTransaction(async (db) => {
      const journalId = await postJournal(
        actor.ws,
        opts.system ? null : actor.person,
        { date, memo: `${d.doc_type === 'bill' ? 'Payment' : 'Receipt'} ${d.number_label}`, sourceType: 'payment', sourceId: paymentId, lines },
        { db },
      );
      await db
        .prepare(
          `INSERT INTO books_payments (id, workspace_id, doc_id, amount, date, method, account_id, fx_rate, reference, provider_ref, journal_id, bank_txn_id, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(paymentId, actor.ws, d.id, amount, date, method, accountId, payFx, clean(input.reference ?? '', 120), input.providerRef ?? null, journalId, input.bankTxnId ?? null, opts.system ? null : actor.person, ts);
      const fresh = (await getDocRow(actor.ws, d.id, db))!;
      if (amount > amountDue(fresh)) throw new BooksError('amount_exceeds_due', 409, { due: amountDue(fresh) });
      const res = await db
        .prepare('UPDATE books_documents SET paid_total = paid_total + ?, updated_at = ? WHERE id = ? AND paid_total = ?')
        .run(amount, ts, d.id, fresh.paid_total);
      if (!res.changes) throw new BooksError('conflict', 409);
      const after = (await getDocRow(actor.ws, d.id, db))!;
      await db.prepare('UPDATE books_documents SET status = ? WHERE id = ?').run(statusFor(after), d.id);
    });
  } catch (err) {
    // Carrera con el mismo providerRef (webhook y vuelta del checkout a la vez): el índice único gana.
    if (input.providerRef && err instanceof Error && /UNIQUE/i.test(err.message)) {
      const dup = (await getDb().prepare('SELECT id FROM books_payments WHERE workspace_id = ? AND provider_ref = ?').get(actor.ws, input.providerRef)) as { id: string } | undefined;
      if (dup) return { doc: (await getDocument(actor.ws, docId))!, paymentId: dup.id, duplicate: true };
    }
    throw err;
  }
  await audit(opts.system ? { ws: actor.ws, person: null } : actor, 'payment.create', d.doc_type, d.id, `${amount} ${d.currency} ${method}`);
  const doc = (await getDocument(actor.ws, docId))!;
  if (doc.status === 'paid' && d.doc_type === 'invoice') {
    const { onInvoicePaid } = await import('./books-integrations');
    await onInvoicePaid(actor.ws, doc).catch((err) => console.error('[books] paid hook', err instanceof Error ? err.message : err));
  }
  return { doc, paymentId };
}

/** Quita un cobro registrado por error: revierte su asiento y devuelve el saldo. */
export async function deletePayment(actor: BooksActor, paymentId: string): Promise<DocDto> {
  const p = (await getDb().prepare('SELECT * FROM books_payments WHERE id = ? AND workspace_id = ?').get(paymentId, actor.ws)) as
    | { id: string; doc_id: string; amount: number; journal_id: string | null; provider_ref: string | null; bank_txn_id: string | null }
    | undefined;
  if (!p) throw new BooksError('not_found', 404);
  const d = (await getDocRow(actor.ws, p.doc_id))!;
  assertCan(actor, d.doc_type === 'bill' ? 'bills.write' : 'invoices.write');
  if (p.provider_ref) throw new BooksError('provider_payment_refund_in_provider', 409);
  const ts = nowDb();
  await inTransaction(async (db) => {
    if (p.journal_id) await reverseJournal(actor.ws, actor.person, p.journal_id, { memo: `Payment removed ${d.number_label}`, db });
    await db.prepare('DELETE FROM books_payments WHERE id = ?').run(p.id);
    await db.prepare('UPDATE books_documents SET paid_total = MAX(0, paid_total - ?), updated_at = ? WHERE id = ?').run(p.amount, ts, d.id);
    if (p.bank_txn_id) await db.prepare("UPDATE books_bank_txns SET status = 'unmatched', payment_id = NULL WHERE id = ?").run(p.bank_txn_id);
    const after = (await getDocRow(actor.ws, d.id, db))!;
    await db.prepare('UPDATE books_documents SET status = ? WHERE id = ?').run(statusFor(after), d.id);
  });
  await audit(actor, 'payment.delete', d.doc_type, d.id, String(p.amount));
  return (await getDocument(actor.ws, d.id))!;
}

// ---------- Link público ----------

export async function setPublicLink(actor: BooksActor, id: string, action: 'revoke' | 'regenerate'): Promise<DocDto> {
  const d = await getDocRow(actor.ws, id);
  if (!d || d.doc_type === 'bill') throw new BooksError('not_found', 404);
  assertCan(actor, 'invoices.write');
  if (d.status === 'draft') throw new BooksError('approve_first', 409);
  if (action === 'revoke') await getDb().prepare('UPDATE books_documents SET public_revoked = 1, updated_at = ? WHERE id = ?').run(nowDb(), id);
  else await getDb().prepare('UPDATE books_documents SET public_token = ?, public_revoked = 0, updated_at = ? WHERE id = ?').run(newToken(), nowDb(), id);
  await audit(actor, `link.${action}`, d.doc_type, id, '');
  return (await getDocument(actor.ws, id))!;
}

/** Documento por su token público (factura o nota de crédito emitida, link vigente). */
export async function getPublicDocRow(token: string): Promise<DocRow | null> {
  if (!token || token.length > 80 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const d = (await getDb().prepare("SELECT * FROM books_documents WHERE public_token = ? AND public_revoked = 0 AND status != 'draft' AND doc_type != 'bill'").get(token)) as DocRow | undefined;
  return d ?? null;
}

export async function markViewed(d: DocRow): Promise<void> {
  if (d.viewed_at) return;
  await getDb().prepare('UPDATE books_documents SET viewed_at = ? WHERE id = ? AND viewed_at IS NULL').run(nowDb(), d.id);
}

export function publicUrl(token: string, locale = 'en'): string {
  const base = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
  return `${base}/${['es', 'pt'].includes(locale) ? locale : 'en'}/invoice/${token}`;
}
