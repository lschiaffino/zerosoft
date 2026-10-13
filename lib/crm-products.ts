/**
 * CRM — catálogo de productos, line items de deals y quotes. Server-only.
 *
 * - Line items: de un producto (copia nombre/sku/precio/impuesto; el precio se
 *   convierte a la moneda del deal si hay tipo de cambio) o custom. La
 *   matemática vive en lib/crm-money.ts (redondeo por línea a la moneda).
 * - Amount del deal: si tiene line items y amount_override = 0, amount = suma
 *   de netos (después de descuento, antes de impuestos). Ver recalcDealAmount.
 * - Quotes: snapshot de los line items al crearlo (no cambia si después se
 *   editan los del deal). draft → sent → accepted | declined | expired. Solo
 *   un quote enviado vence (expires_at < hoy UTC). La página pública /q/<token>
 *   no muestra borradores.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { CrmRefError } from './crm-refs';
import { getCurrencyContext, getCrmSettings } from './crm-currency';
import { convertAmount, lineTotals, roundMoney, sumLines, type DocTotals, type LineTotals } from './crm-money';
import { RECURRING_INTERVALS, type RecurringInterval } from './crm-constants';
import {
  getDb,
  type CrmDealRow,
  type CrmLineItemRow,
  type CrmProductRow,
  type CrmQuoteRow,
  type CrmQuoteStatus,
  type Db,
} from './db';

function nowDb(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function normRecurring(v: string | undefined): RecurringInterval {
  return v && (RECURRING_INTERVALS as readonly string[]).includes(v) ? (v as RecurringInterval) : 'none';
}

// ============================================================
// PRODUCTS
// ============================================================

export interface ProductInput {
  name?: string;
  sku?: string;
  description?: string;
  price?: number;
  currency?: string;
  recurring?: RecurringInterval;
  taxPct?: number;
  active?: boolean;
}

export interface ProductFilter {
  q?: string;
  /** undefined = todos; true = activos; false = archivados. */
  active?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listProducts(
  userId: string,
  f: ProductFilter = {},
): Promise<{ rows: CrmProductRow[]; total: number }> {
  const db = getDb();
  const where = ['user_id = ?'];
  const args: Array<string | number> = [userId];
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    where.push(`(name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\')`);
    args.push(like, like);
  }
  if (f.active !== undefined) {
    where.push('active = ?');
    args.push(f.active ? 1 : 0);
  }
  const whereSql = where.join(' AND ');
  const total = ((await db.prepare(`SELECT COUNT(*) AS c FROM crm_products WHERE ${whereSql}`).get(...args)) as {
    c: number;
  }).c;
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 200);
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(f.page ?? 1, 1), pages);
  const rows = (await db
    .prepare(
      `SELECT * FROM crm_products WHERE ${whereSql}
       ORDER BY active DESC, name COLLATE NOCASE ASC, id LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize)) as CrmProductRow[];
  return { rows, total };
}

export async function getProduct(userId: string, id: string, db: Db = getDb()): Promise<CrmProductRow | null> {
  return (
    ((await db.prepare('SELECT * FROM crm_products WHERE id = ? AND user_id = ?').get(id, userId)) as
      | CrmProductRow
      | undefined) ?? null
  );
}

export async function createProduct(userId: string, data: ProductInput, db: Db = getDb()): Promise<CrmProductRow> {
  const id = crypto.randomUUID();
  const currency = (data.currency || (await getCrmSettings(userId, db)).baseCurrency).toUpperCase();
  await db
    .prepare(
      `INSERT INTO crm_products (id, user_id, name, sku, description, price, currency, recurring, tax_pct, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      (data.name ?? '').trim(),
      (data.sku ?? '').trim(),
      data.description ?? '',
      roundMoney(data.price ?? 0, currency),
      currency,
      normRecurring(data.recurring),
      data.taxPct ?? 0,
      data.active === false ? 0 : 1,
      nowDb(),
      nowDb(),
    );
  return (await getProduct(userId, id, db))!;
}

const PRODUCT_COLS: Record<keyof ProductInput, string> = {
  name: 'name',
  sku: 'sku',
  description: 'description',
  price: 'price',
  currency: 'currency',
  recurring: 'recurring',
  taxPct: 'tax_pct',
  active: 'active',
};

export async function updateProduct(
  userId: string,
  id: string,
  data: ProductInput,
  db: Db = getDb(),
): Promise<CrmProductRow | null> {
  const existing = await getProduct(userId, id, db);
  if (!existing) return null;
  const sets: Array<[string, string | number]> = [];
  for (const [key, col] of Object.entries(PRODUCT_COLS) as Array<[keyof ProductInput, string]>) {
    const v = data[key];
    if (v === undefined) continue;
    if (key === 'active') sets.push([col, v ? 1 : 0]);
    else if (key === 'currency') sets.push([col, String(v).toUpperCase()]);
    else if (key === 'recurring') sets.push([col, normRecurring(String(v))]);
    else if (typeof v === 'string') sets.push([col, key === 'description' ? v : v.trim()]);
    else sets.push([col, v as number]);
  }
  if (sets.length) {
    await db
      .prepare(`UPDATE crm_products SET ${sets.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...sets.map(([, v]) => v), nowDb(), id);
  }
  return getProduct(userId, id, db);
}

/** Borra el producto. Los line items que lo usaban quedan como custom (FK SET NULL). */
export async function deleteProduct(userId: string, id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM crm_products WHERE id = ? AND user_id = ?').run(id, userId)).changes > 0;
}

// ============================================================
// LINE ITEMS
// ============================================================

export interface LineItemInput {
  productId?: string | null;
  name?: string;
  sku?: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  discountPct?: number;
  taxPct?: number;
  recurring?: RecurringInterval;
  position?: number;
}

export type LineItemWithTotals = CrmLineItemRow & LineTotals;

export interface DealLineSummary {
  currency: string;
  items: LineItemWithTotals[];
  totals: DocTotals;
  amountOverride: boolean;
}

async function ownedDeal(userId: string, dealId: string, db: Db): Promise<CrmDealRow> {
  const deal = (await db.prepare('SELECT * FROM crm_deals WHERE id = ? AND user_id = ?').get(dealId, userId)) as
    | CrmDealRow
    | undefined;
  if (!deal) throw new CrmRefError('invalid_deal');
  return deal;
}

export async function listLineItems(userId: string, dealId: string, db: Db = getDb()): Promise<DealLineSummary | null> {
  const deal = (await db.prepare('SELECT * FROM crm_deals WHERE id = ? AND user_id = ?').get(dealId, userId)) as
    | CrmDealRow
    | undefined;
  if (!deal) return null;
  const rows = (await db
    .prepare('SELECT * FROM crm_line_items WHERE deal_id = ? AND user_id = ? ORDER BY position ASC, created_at ASC')
    .all(dealId, userId)) as CrmLineItemRow[];
  const items = rows.map((r) => ({ ...r, ...lineTotals(r, deal.currency) }));
  return {
    currency: deal.currency,
    items,
    totals: sumLines(rows, deal.currency),
    amountOverride: !!deal.amount_override,
  };
}

/**
 * Recalcula el amount del deal desde sus line items (suma de netos), salvo
 * override manual o deal sin line items. Devuelve el amount vigente.
 */
export async function recalcDealAmount(userId: string, dealId: string, db: Db = getDb()): Promise<number> {
  const deal = await ownedDeal(userId, dealId, db);
  const rows = (await db
    .prepare('SELECT quantity, unit_price, discount_pct, tax_pct FROM crm_line_items WHERE deal_id = ?')
    .all(dealId)) as CrmLineItemRow[];
  if (!rows.length || deal.amount_override) return deal.amount;
  const amount = sumLines(rows, deal.currency).net;
  if (amount !== deal.amount) {
    await db.prepare('UPDATE crm_deals SET amount = ?, updated_at = ? WHERE id = ?').run(amount, nowDb(), dealId);
  }
  return amount;
}

export async function addLineItem(
  userId: string,
  dealId: string,
  data: LineItemInput,
  db: Db = getDb(),
): Promise<LineItemWithTotals> {
  const deal = await ownedDeal(userId, dealId, db);
  let name = (data.name ?? '').trim();
  let sku = data.sku ?? '';
  let description = data.description ?? '';
  let unitPrice = data.unitPrice;
  let taxPct = data.taxPct;
  let recurring = data.recurring;
  if (data.productId) {
    const product = await getProduct(userId, data.productId, db);
    if (!product) throw new CrmRefError('invalid_product');
    name ||= product.name;
    sku ||= product.sku;
    description ||= product.description;
    taxPct ??= product.tax_pct;
    recurring ??= product.recurring;
    if (unitPrice === undefined) {
      const ctx = await getCurrencyContext(userId, db);
      unitPrice = convertAmount(product.price, product.currency, deal.currency, ctx) ?? product.price;
    }
  }
  if (!name) throw new CrmRefError('missing_name');
  const maxPos = ((await db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM crm_line_items WHERE deal_id = ?')
    .get(dealId)) as { m: number }).m;
  const id = crypto.randomUUID();
  const ts = nowDb();
  await db
    .prepare(
      `INSERT INTO crm_line_items (id, user_id, deal_id, product_id, name, sku, description, quantity, unit_price,
         discount_pct, tax_pct, recurring, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      dealId,
      data.productId ?? null,
      name,
      sku,
      description,
      data.quantity ?? 1,
      roundMoney(unitPrice ?? 0, deal.currency),
      data.discountPct ?? 0,
      taxPct ?? 0,
      normRecurring(recurring),
      data.position ?? maxPos + 1,
      ts,
      ts,
    );
  await recalcDealAmount(userId, dealId, db);
  const row = (await db.prepare('SELECT * FROM crm_line_items WHERE id = ?').get(id)) as CrmLineItemRow;
  return { ...row, ...lineTotals(row, deal.currency) };
}

const LINE_COLS: Record<string, string> = {
  name: 'name',
  sku: 'sku',
  description: 'description',
  quantity: 'quantity',
  unitPrice: 'unit_price',
  discountPct: 'discount_pct',
  taxPct: 'tax_pct',
  recurring: 'recurring',
  position: 'position',
};

export async function updateLineItem(
  userId: string,
  dealId: string,
  itemId: string,
  data: LineItemInput,
  db: Db = getDb(),
): Promise<LineItemWithTotals | null> {
  const deal = await ownedDeal(userId, dealId, db);
  const existing = (await db
    .prepare('SELECT * FROM crm_line_items WHERE id = ? AND deal_id = ? AND user_id = ?')
    .get(itemId, dealId, userId)) as CrmLineItemRow | undefined;
  if (!existing) return null;
  const sets: Array<[string, string | number]> = [];
  for (const [key, col] of Object.entries(LINE_COLS)) {
    const v = (data as Record<string, unknown>)[key];
    if (v === undefined) continue;
    if (key === 'name' && !String(v).trim()) throw new CrmRefError('missing_name');
    if (key === 'unitPrice') sets.push([col, roundMoney(Number(v), deal.currency)]);
    else if (key === 'recurring') sets.push([col, normRecurring(String(v))]);
    else sets.push([col, typeof v === 'string' && key !== 'description' ? v.trim() : (v as string | number)]);
  }
  if (sets.length) {
    await db
      .prepare(`UPDATE crm_line_items SET ${sets.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...sets.map(([, v]) => v), nowDb(), itemId);
    await recalcDealAmount(userId, dealId, db);
  }
  const row = (await db.prepare('SELECT * FROM crm_line_items WHERE id = ?').get(itemId)) as CrmLineItemRow;
  return { ...row, ...lineTotals(row, deal.currency) };
}

export async function deleteLineItem(userId: string, dealId: string, itemId: string, db: Db = getDb()): Promise<boolean> {
  await ownedDeal(userId, dealId, db);
  const res = await db
    .prepare('DELETE FROM crm_line_items WHERE id = ? AND deal_id = ? AND user_id = ?')
    .run(itemId, dealId, userId);
  if (res.changes > 0) await recalcDealAmount(userId, dealId, db);
  return res.changes > 0;
}

// ============================================================
// QUOTES
// ============================================================

export interface QuoteItemSnapshot {
  name: string;
  sku: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_pct: number;
  recurring: string;
  subtotal: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
}

export interface QuoteInput {
  title?: string;
  expiresAt?: string | null;
  terms?: string;
  notes?: string;
  senderName?: string;
  senderEmail?: string;
  senderCompany?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientCompany?: string;
}

export type QuoteView = CrmQuoteRow & { deal_name: string | null; parsed_items: QuoteItemSnapshot[] };

export function parseQuoteItems(json: string): QuoteItemSnapshot[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as QuoteItemSnapshot[]) : [];
  } catch {
    return [];
  }
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

/** HMAC de la IP: el quote guarda prueba de quién firmó sin guardar la IP en claro. */
export function hashQuoteIp(ip: string): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || 'zerosoft-quotes';
  return createHmac('sha256', secret).update(`quote:${ip}`).digest('hex');
}

/** Los quotes enviados cuyo vencimiento pasó quedan 'expired'. */
async function expireQuotes(db: Db, where: string, args: string[]): Promise<void> {
  await db
    .prepare(
      `UPDATE crm_quotes SET status = 'expired', updated_at = ?
       WHERE status = 'sent' AND expires_at IS NOT NULL AND expires_at < ? AND ${where}`,
    )
    .run(nowDb(), todayUtc(), ...args);
}

async function snapshotItems(userId: string, dealId: string, db: Db): Promise<{ items: QuoteItemSnapshot[]; totals: DocTotals; currency: string }> {
  const summary = await listLineItems(userId, dealId, db);
  if (!summary) throw new CrmRefError('invalid_deal');
  const items = summary.items.map((i) => ({
    name: i.name,
    sku: i.sku,
    description: i.description,
    quantity: i.quantity,
    unit_price: i.unit_price,
    discount_pct: i.discount_pct,
    tax_pct: i.tax_pct,
    recurring: i.recurring,
    subtotal: i.subtotal,
    discount: i.discount,
    net: i.net,
    tax: i.tax,
    total: i.total,
  }));
  return { items, totals: summary.totals, currency: summary.currency };
}

export type CreateQuoteResult = { ok: true; quote: QuoteView } | { ok: false; error: 'no_line_items' };

export async function createQuote(
  userId: string,
  dealId: string,
  data: QuoteInput,
  createdBy: string | null = null,
  db: Db = getDb(),
): Promise<CreateQuoteResult> {
  const deal = await ownedDeal(userId, dealId, db);
  const snap = await snapshotItems(userId, dealId, db);
  if (!snap.items.length) return { ok: false, error: 'no_line_items' };

  // Destinatario por defecto: primer contacto del deal y su empresa primaria.
  const contact = (await db
    .prepare(
      `SELECT c.first_name, c.last_name, c.email FROM crm_contacts c
       JOIN crm_deal_contacts dc ON dc.contact_id = c.id WHERE dc.deal_id = ? ORDER BY dc.rowid LIMIT 1`,
    )
    .get(dealId)) as { first_name: string; last_name: string; email: string } | undefined;
  const company = (await db
    .prepare(
      `SELECT co.name FROM crm_deal_companies dc JOIN crm_companies co ON co.id = dc.company_id
       WHERE dc.deal_id = ? AND dc.is_primary = 1`,
    )
    .get(dealId)) as { name: string } | undefined;

  const year = new Date().getUTCFullYear();
  // Siguiente número del año (máximo + 1, así borrar un quote no repite números).
  const last = ((await db
    .prepare(
      `SELECT COALESCE(MAX(CAST(substr(number, 8) AS INTEGER)), 0) AS n FROM crm_quotes
       WHERE user_id = ? AND number LIKE ?`,
    )
    .get(userId, `Q-${year}-%`)) as { n: number }).n;
  const number = `Q-${year}-${String(last + 1).padStart(4, '0')}`;
  const expires =
    data.expiresAt === undefined
      ? new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
      : data.expiresAt
        ? data.expiresAt.slice(0, 10)
        : null;
  const id = crypto.randomUUID();
  const ts = nowDb();
  await db
    .prepare(
      `INSERT INTO crm_quotes (id, user_id, deal_id, number, title, status, token, currency, items,
         subtotal, discount_total, tax_total, total, expires_at, terms, notes,
         sender_name, sender_email, sender_company, recipient_name, recipient_email, recipient_company,
         created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      dealId,
      number,
      (data.title ?? '').trim() || deal.name,
      newToken(),
      snap.currency,
      JSON.stringify(snap.items),
      snap.totals.subtotal,
      snap.totals.discount,
      snap.totals.tax,
      snap.totals.total,
      expires,
      data.terms ?? '',
      data.notes ?? '',
      data.senderName ?? '',
      data.senderEmail ?? '',
      data.senderCompany ?? '',
      data.recipientName ?? (contact ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') : ''),
      data.recipientEmail ?? contact?.email ?? '',
      data.recipientCompany ?? company?.name ?? '',
      createdBy,
      ts,
      ts,
    );
  return { ok: true, quote: (await getQuote(userId, id, db))! };
}

export async function getQuote(userId: string, id: string, db: Db = getDb()): Promise<QuoteView | null> {
  await expireQuotes(db, 'id = ? AND user_id = ?', [id, userId]);
  const row = (await db
    .prepare(
      `SELECT q.*, d.name AS deal_name FROM crm_quotes q LEFT JOIN crm_deals d ON d.id = q.deal_id
       WHERE q.id = ? AND q.user_id = ?`,
    )
    .get(id, userId)) as (CrmQuoteRow & { deal_name: string | null }) | undefined;
  return row ? { ...row, parsed_items: parseQuoteItems(row.items) } : null;
}

export interface QuoteFilter {
  dealId?: string;
  status?: CrmQuoteStatus;
  page?: number;
  pageSize?: number;
}

export async function listQuotes(
  userId: string,
  f: QuoteFilter = {},
): Promise<{ rows: Array<CrmQuoteRow & { deal_name: string | null }>; total: number }> {
  const db = getDb();
  await expireQuotes(db, 'user_id = ?', [userId]);
  const where = ['q.user_id = ?'];
  const args: Array<string | number> = [userId];
  if (f.dealId) {
    where.push('q.deal_id = ?');
    args.push(f.dealId);
  }
  if (f.status) {
    where.push('q.status = ?');
    args.push(f.status);
  }
  const whereSql = where.join(' AND ');
  const total = ((await db.prepare(`SELECT COUNT(*) AS c FROM crm_quotes q WHERE ${whereSql}`).get(...args)) as {
    c: number;
  }).c;
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(f.page ?? 1, 1), pages);
  const rows = (await db
    .prepare(
      `SELECT q.*, d.name AS deal_name FROM crm_quotes q LEFT JOIN crm_deals d ON d.id = q.deal_id
       WHERE ${whereSql} ORDER BY q.created_at DESC, q.id LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize)) as Array<CrmQuoteRow & { deal_name: string | null }>;
  return { rows, total };
}

export type QuoteUpdateResult =
  | { ok: true; quote: QuoteView }
  | { ok: false; error: 'not_found' | 'not_draft' | 'no_line_items' };

/** Edita un borrador. `refreshItems` vuelve a tomar los line items actuales del deal. */
export async function updateQuote(
  userId: string,
  id: string,
  data: QuoteInput & { refreshItems?: boolean },
  db: Db = getDb(),
): Promise<QuoteUpdateResult> {
  const quote = await getQuote(userId, id, db);
  if (!quote) return { ok: false, error: 'not_found' };
  if (quote.status !== 'draft') return { ok: false, error: 'not_draft' };
  const cols: Record<string, string> = {
    title: 'title',
    terms: 'terms',
    notes: 'notes',
    senderName: 'sender_name',
    senderEmail: 'sender_email',
    senderCompany: 'sender_company',
    recipientName: 'recipient_name',
    recipientEmail: 'recipient_email',
    recipientCompany: 'recipient_company',
  };
  const sets: Array<[string, string | number | null]> = [];
  for (const [key, col] of Object.entries(cols)) {
    const v = (data as Record<string, unknown>)[key];
    if (typeof v === 'string') sets.push([col, v]);
  }
  if (data.expiresAt !== undefined) sets.push(['expires_at', data.expiresAt ? data.expiresAt.slice(0, 10) : null]);
  if (data.refreshItems) {
    const snap = await snapshotItems(userId, quote.deal_id, db);
    if (!snap.items.length) return { ok: false, error: 'no_line_items' };
    sets.push(
      ['items', JSON.stringify(snap.items)],
      ['currency', snap.currency],
      ['subtotal', snap.totals.subtotal],
      ['discount_total', snap.totals.discount],
      ['tax_total', snap.totals.tax],
      ['total', snap.totals.total],
    );
  }
  if (sets.length) {
    await db
      .prepare(`UPDATE crm_quotes SET ${sets.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...sets.map(([, v]) => v), nowDb(), id);
  }
  return { ok: true, quote: (await getQuote(userId, id, db))! };
}

/** draft → sent: el link público empieza a funcionar. */
export async function markQuoteSent(userId: string, id: string, db: Db = getDb()): Promise<QuoteUpdateResult> {
  const quote = await getQuote(userId, id, db);
  if (!quote) return { ok: false, error: 'not_found' };
  if (quote.status !== 'draft') return { ok: false, error: 'not_draft' };
  await db
    .prepare("UPDATE crm_quotes SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?")
    .run(nowDb(), nowDb(), id);
  return { ok: true, quote: (await getQuote(userId, id, db))! };
}

export async function deleteQuote(userId: string, id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM crm_quotes WHERE id = ? AND user_id = ?').run(id, userId)).changes > 0;
}

// ---------- Página pública /q/<token> ----------

export interface PublicQuote {
  number: string;
  title: string;
  status: CrmQuoteStatus;
  currency: string;
  items: QuoteItemSnapshot[];
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  expires_at: string | null;
  terms: string;
  notes: string;
  sender_name: string;
  sender_email: string;
  sender_company: string;
  recipient_name: string;
  recipient_email: string;
  recipient_company: string;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  signer_name: string;
  decline_reason: string;
  created_at: string;
}

/** Quote por token para la página pública (null si no existe o es borrador). */
export async function getPublicQuote(token: string, db: Db = getDb()): Promise<PublicQuote | null> {
  if (!token || token.length > 100) return null;
  await expireQuotes(db, 'token = ?', [token]);
  const q = (await db.prepare("SELECT * FROM crm_quotes WHERE token = ? AND status != 'draft'").get(token)) as
    | CrmQuoteRow
    | undefined;
  if (!q) return null;
  return {
    number: q.number,
    title: q.title,
    status: q.status,
    currency: q.currency,
    items: parseQuoteItems(q.items),
    subtotal: q.subtotal,
    discount_total: q.discount_total,
    tax_total: q.tax_total,
    total: q.total,
    expires_at: q.expires_at,
    terms: q.terms,
    notes: q.notes,
    sender_name: q.sender_name,
    sender_email: q.sender_email,
    sender_company: q.sender_company,
    recipient_name: q.recipient_name,
    recipient_email: q.recipient_email,
    recipient_company: q.recipient_company,
    sent_at: q.sent_at,
    accepted_at: q.accepted_at,
    declined_at: q.declined_at,
    signer_name: q.signer_name,
    decline_reason: q.decline_reason,
    created_at: q.created_at,
  };
}

export type QuoteResponseError = 'not_found' | 'expired' | 'not_open' | 'invalid_signature';
export type QuoteResponseResult = { ok: true; quote: PublicQuote } | { ok: false; error: QuoteResponseError };

async function openQuoteByToken(token: string, db: Db): Promise<CrmQuoteRow | QuoteResponseError> {
  await expireQuotes(db, 'token = ?', [token]);
  const q = (await db.prepare("SELECT * FROM crm_quotes WHERE token = ? AND status != 'draft'").get(token)) as
    | CrmQuoteRow
    | undefined;
  if (!q) return 'not_found';
  if (q.status === 'expired') return 'expired';
  if (q.status !== 'sent') return 'not_open';
  return q;
}

/**
 * El cliente acepta: nombre tipeado + checkbox. Guarda nombre, hora y hash de
 * IP; registra actividad en el deal, avisa al owner, dispara el workflow
 * quote_accepted y el evento de Flow quote.accepted; opcionalmente mueve el
 * deal a la primera etapa ganada de su pipeline (ajuste del workspace).
 */
export async function acceptQuote(
  token: string,
  input: { name: string; agree: boolean; ip: string },
  db: Db = getDb(),
): Promise<QuoteResponseResult> {
  const name = input.name.trim().slice(0, 200);
  if (!name || !input.agree) return { ok: false, error: 'invalid_signature' };
  const q = await openQuoteByToken(token, db);
  if (typeof q === 'string') return { ok: false, error: q };
  const ts = nowDb();
  // Condicional: si dos personas aceptan a la vez solo una gana.
  const res = await db
    .prepare(
      `UPDATE crm_quotes SET status = 'accepted', accepted_at = ?, signer_name = ?, signer_ip_hash = ?, updated_at = ?
       WHERE id = ? AND status = 'sent'`,
    )
    .run(ts, name, hashQuoteIp(input.ip), ts, q.id);
  if (res.changes === 0) return { ok: false, error: 'not_open' };
  await onQuoteResponded(q, 'accepted', name, '');
  return { ok: true, quote: (await getPublicQuote(token, db))! };
}

export async function declineQuote(
  token: string,
  input: { reason?: string; ip: string },
  db: Db = getDb(),
): Promise<QuoteResponseResult> {
  const q = await openQuoteByToken(token, db);
  if (typeof q === 'string') return { ok: false, error: q };
  const ts = nowDb();
  const reason = (input.reason ?? '').trim().slice(0, 1000);
  const res = await db
    .prepare(
      `UPDATE crm_quotes SET status = 'declined', declined_at = ?, decline_reason = ?, signer_ip_hash = ?, updated_at = ?
       WHERE id = ? AND status = 'sent'`,
    )
    .run(ts, reason, hashQuoteIp(input.ip), ts, q.id);
  if (res.changes === 0) return { ok: false, error: 'not_open' };
  await onQuoteResponded(q, 'declined', '', reason);
  return { ok: true, quote: (await getPublicQuote(token, db))! };
}

/** Efectos de aceptar/rechazar. Nunca lanzan: la respuesta del cliente ya quedó guardada. */
async function onQuoteResponded(
  q: CrmQuoteRow,
  outcome: 'accepted' | 'declined',
  signer: string,
  reason: string,
): Promise<void> {
  const userId = q.user_id;
  const money = new Intl.NumberFormat('en', { style: 'currency', currency: q.currency || 'USD' }).format(q.total);
  const deal = (await getDb().prepare('SELECT * FROM crm_deals WHERE id = ?').get(q.deal_id)) as CrmDealRow | undefined;
  try {
    const { createActivity } = await import('./crm');
    await createActivity(userId, {
      type: 'note',
      subject:
        outcome === 'accepted'
          ? `Quote ${q.number} accepted by ${signer}`
          : `Quote ${q.number} declined`,
      body:
        outcome === 'accepted'
          ? `${q.title} — ${money}. Accepted online on the quote page.`
          : `${q.title} — ${money}.${reason ? ` Reason: ${reason}` : ''}`,
      dealId: q.deal_id,
    });
  } catch {
    /* sin actividad no se pierde la respuesta */
  }
  try {
    const { createNotification } = await import('./notifications');
    await createNotification({
      userId: deal?.owner_id ?? userId,
      type: 'crm_quote',
      title: outcome === 'accepted' ? `Quote ${q.number} accepted` : `Quote ${q.number} declined`,
      body: outcome === 'accepted' ? `${signer} accepted ${q.title} (${money})` : `${q.title} (${money})`,
      href: `/app/crm/quotes/${q.id}`,
      sourceType: 'crm_quote',
      sourceId: q.id,
    });
  } catch {
    /* idem */
  }
  if (outcome !== 'accepted') return;
  const payload = {
    id: q.id,
    number: q.number,
    title: q.title,
    total: q.total,
    currency: q.currency,
    dealId: q.deal_id,
    dealName: deal?.name ?? '',
    signerName: signer,
  };
  try {
    const { fireCrmEvent } = await import('./crm');
    await fireCrmEvent(userId, { type: 'quote_accepted', entity: 'deal', entityId: q.deal_id, payload });
  } catch {
    /* idem */
  }
  try {
    const { emitEvent } = await import('./events');
    await emitEvent(userId, 'quote.accepted', payload);
  } catch {
    /* idem */
  }
  try {
    const settings = await getCrmSettings(userId);
    if (settings.quoteAcceptMovesDeal && deal) {
      const won = (await getDb()
        .prepare('SELECT id FROM crm_stages WHERE pipeline_id = ? AND is_won = 1 ORDER BY position ASC LIMIT 1')
        .get(deal.pipeline_id)) as { id: string } | undefined;
      if (won && won.id !== deal.stage_id) {
        const { moveDeal } = await import('./crm');
        await moveDeal(userId, deal.id, won.id, null, undefined, `quote ${q.number}`);
      }
    }
  } catch {
    /* idem */
  }
}
