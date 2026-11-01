/**
 * Books: presupuestos propios (Xero Quotes). Borrador → enviado → aceptado o
 * rechazado por el cliente desde un link sin login → factura en borrador. Un
 * presupuesto no toca el libro: nada de esto genera asientos. Server-only.
 */
import { getDb } from './db';
import { assertCan, audit, ensureBooks, getContactRow } from './books';
import { createDraft, resolveLines, type DocDto, type LineInputDto, type ResolvedLine } from './books-docs';
import { BooksError, clean, newId, newToken, nowDb, parseJson, type BooksActor } from './books-schema';
import { addDays, CURRENCY_RE, docTotals, formatMoney, isValidDate, normalizeRate, todayIso } from './books-money';
import { escapeHtml, namedSender, renderBrandedHtml, sendEmail } from './email';
import { assertBooksMailAllowed } from './books-mail-guard';

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'invoiced';

interface QuoteRow {
  id: string;
  workspace_id: string;
  number: number | null;
  status: string;
  contact_id: string | null;
  title: string;
  issue_date: string;
  expiry_date: string | null;
  currency: string;
  fx_rate: string;
  tax_inclusive: number;
  lines: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  terms: string;
  public_token: string | null;
  public_revoked: number;
  sent_at: string | null;
  viewed_at: string | null;
  decided_at: string | null;
  decided_name: string;
  invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteLineDto extends ResolvedLine {
  net: number;
  tax: number;
  total: number;
}

export interface QuoteDto {
  id: string;
  label: string;
  status: QuoteStatus;
  contactId: string | null;
  contactName: string;
  contactEmail: string;
  title: string;
  issueDate: string;
  expiryDate: string | null;
  currency: string;
  fxRate: string;
  taxInclusive: boolean;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  terms: string;
  publicToken: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  decidedAt: string | null;
  decidedName: string;
  invoiceId: string | null;
  lines: QuoteLineDto[];
  taxBreakdown: Array<{ taxBps: number; net: number; tax: number }>;
  createdAt: string;
}

export function quoteLabel(n: number | null): string {
  return n == null ? '' : `Q-${String(n).padStart(6, '0')}`;
}

/** Vencido se calcula al leer: enviado con la fecha ya pasada. Sin cron que pueda fallar. */
export function effectiveQuoteStatus(status: string, expiry: string | null, today = todayIso()): QuoteStatus {
  if (status === 'sent' && expiry && expiry < today) return 'expired';
  return status as QuoteStatus;
}

async function toDto(r: QuoteRow): Promise<QuoteDto> {
  const contact = await getContactRow(r.workspace_id, r.contact_id);
  const lines = parseJson<ResolvedLine[]>(r.lines, []);
  const totals = docTotals(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountBps: l.discountBps, taxBps: l.taxBps })), r.tax_inclusive === 1);
  return {
    id: r.id,
    label: quoteLabel(r.number),
    status: effectiveQuoteStatus(r.status, r.expiry_date),
    contactId: r.contact_id,
    contactName: contact?.name ?? '',
    contactEmail: contact?.email ?? '',
    title: r.title,
    issueDate: r.issue_date,
    expiryDate: r.expiry_date,
    currency: r.currency,
    fxRate: r.fx_rate,
    taxInclusive: r.tax_inclusive === 1,
    subtotal: r.subtotal,
    discountTotal: r.discount_total,
    taxTotal: r.tax_total,
    total: r.total,
    terms: r.terms,
    publicToken: r.public_revoked ? null : r.public_token,
    sentAt: r.sent_at,
    viewedAt: r.viewed_at,
    decidedAt: r.decided_at,
    decidedName: r.decided_name,
    invoiceId: r.invoice_id,
    lines: lines.map((l, i) => ({ ...l, net: totals.lines[i].net, tax: totals.lines[i].tax, total: totals.lines[i].total })),
    taxBreakdown: totals.byRate,
    createdAt: r.created_at,
  };
}

async function row(ws: string, id: string): Promise<QuoteRow | null> {
  return ((await getDb().prepare('SELECT * FROM books_quotes WHERE id = ? AND workspace_id = ?').get(id, ws)) as QuoteRow | undefined) ?? null;
}

export async function getQuote(ws: string, id: string): Promise<QuoteDto | null> {
  const r = await row(ws, id);
  return r ? toDto(r) : null;
}

export async function listQuotes(ws: string, opts: { q?: string; status?: string } = {}): Promise<QuoteDto[]> {
  await ensureBooks(ws);
  const where = ['q.workspace_id = ?'];
  const args: string[] = [ws];
  if (opts.q?.trim()) {
    const l = `%${opts.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(q.title LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')");
    args.push(l, l);
  }
  const rows = (await getDb()
    .prepare(`SELECT q.* FROM books_quotes q LEFT JOIN books_contacts c ON c.id = q.contact_id WHERE ${where.join(' AND ')} ORDER BY q.issue_date DESC, q.created_at DESC LIMIT 300`)
    .all(...args)) as QuoteRow[];
  const all = await Promise.all(rows.map(toDto));
  return opts.status ? all.filter((x) => x.status === opts.status) : all;
}

export interface QuoteInput {
  contactId?: string | null;
  title?: string;
  issueDate?: string;
  expiryDate?: string | null;
  currency?: string;
  fxRate?: string | number;
  taxInclusive?: boolean;
  terms?: string;
  lines?: LineInputDto[];
}

async function fields(actor: BooksActor, input: QuoteInput, cur: QuoteRow | null) {
  const s = await ensureBooks(actor.ws);
  const contactId = input.contactId !== undefined ? input.contactId : (cur?.contact_id ?? null);
  if (contactId && !(await getContactRow(actor.ws, contactId))) throw new BooksError('invalid_contact');
  const issueDate = input.issueDate ?? cur?.issue_date ?? todayIso();
  if (!isValidDate(issueDate)) throw new BooksError('invalid_date');
  const expiryDate = input.expiryDate !== undefined ? input.expiryDate || null : (cur?.expiry_date ?? addDays(issueDate, 30));
  if (expiryDate && (!isValidDate(expiryDate) || expiryDate < issueDate)) throw new BooksError('invalid_due_date');
  const currency = (input.currency ?? cur?.currency ?? s.base_currency).toUpperCase();
  if (!CURRENCY_RE.test(currency)) throw new BooksError('invalid_currency');
  const fx = currency === s.base_currency ? '1' : normalizeRate(input.fxRate ?? (cur?.currency === currency ? cur.fx_rate : undefined));
  if (!fx) throw new BooksError('fx_rate_required');
  const taxInclusive = input.taxInclusive !== undefined ? Boolean(input.taxInclusive) : cur?.tax_inclusive === 1;
  const lines = input.lines ? await resolveLines(actor.ws, 'invoice', currency, input.lines) : parseJson<ResolvedLine[]>(cur?.lines, []);
  const totals = docTotals(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountBps: l.discountBps, taxBps: l.taxBps })), taxInclusive);
  return { contactId, issueDate, expiryDate, currency, fx, taxInclusive, lines, totals, title: input.title !== undefined ? clean(input.title, 160) : (cur?.title ?? ''), terms: input.terms !== undefined ? clean(input.terms, 4000) : (cur?.terms ?? '') };
}

export async function createQuote(actor: BooksActor, input: QuoteInput): Promise<QuoteDto> {
  assertCan(actor, 'invoices.write');
  const f = await fields(actor, input, null);
  const id = newId('quo');
  const ts = nowDb();
  await getDb()
    .prepare(
      `INSERT INTO books_quotes (id, workspace_id, status, contact_id, title, issue_date, expiry_date, currency, fx_rate, tax_inclusive, lines, subtotal, discount_total, tax_total, total, terms, created_by, created_at, updated_at)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, actor.ws, f.contactId, f.title, f.issueDate, f.expiryDate, f.currency, f.fx, f.taxInclusive ? 1 : 0, JSON.stringify(f.lines), f.totals.subtotal, f.totals.discountTotal, f.totals.taxTotal, f.totals.total, f.terms, actor.person, ts, ts);
  await audit(actor, 'quote.create', 'quote', id, f.title);
  return (await getQuote(actor.ws, id))!;
}

/** Un borrador se edita entero. Enviado, solo cambia el título; para cambiar importes se vuelve a borrador. */
export async function updateQuote(actor: BooksActor, id: string, input: QuoteInput & { status?: 'draft' }): Promise<QuoteDto> {
  assertCan(actor, 'invoices.write');
  const cur = await row(actor.ws, id);
  if (!cur) throw new BooksError('not_found', 404);
  if (input.status === 'draft') {
    if (cur.status !== 'sent') throw new BooksError('invalid_status', 409);
    // El link deja de servir hasta el próximo envío: nadie acepta un texto que se está cambiando.
    await getDb().prepare("UPDATE books_quotes SET status = 'draft', public_revoked = 1, updated_at = ? WHERE id = ? AND status = 'sent'").run(nowDb(), id);
    await audit(actor, 'quote.redraft', 'quote', id, '');
    return (await getQuote(actor.ws, id))!;
  }
  if (cur.status !== 'draft') {
    if (Object.keys(input).every((k) => k === 'title')) {
      await getDb().prepare('UPDATE books_quotes SET title = ?, updated_at = ? WHERE id = ?').run(clean(input.title ?? '', 160), nowDb(), id);
      return (await getQuote(actor.ws, id))!;
    }
    throw new BooksError('document_posted', 409);
  }
  const f = await fields(actor, input, cur);
  const res = await getDb()
    .prepare(
      `UPDATE books_quotes SET contact_id = ?, title = ?, issue_date = ?, expiry_date = ?, currency = ?, fx_rate = ?, tax_inclusive = ?, lines = ?, subtotal = ?, discount_total = ?, tax_total = ?, total = ?, terms = ?, updated_at = ?
       WHERE id = ? AND status = 'draft'`,
    )
    .run(f.contactId, f.title, f.issueDate, f.expiryDate, f.currency, f.fx, f.taxInclusive ? 1 : 0, JSON.stringify(f.lines), f.totals.subtotal, f.totals.discountTotal, f.totals.taxTotal, f.totals.total, f.terms, nowDb(), id);
  if (!res.changes) throw new BooksError('document_posted', 409);
  await audit(actor, 'quote.update', 'quote', id, '');
  return (await getQuote(actor.ws, id))!;
}

export async function deleteQuote(actor: BooksActor, id: string): Promise<void> {
  assertCan(actor, 'invoices.write');
  const cur = await row(actor.ws, id);
  if (!cur) throw new BooksError('not_found', 404);
  if (cur.invoice_id) throw new BooksError('quote_invoiced', 409);
  await getDb().prepare('DELETE FROM books_quotes WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
  await audit(actor, 'quote.delete', 'quote', id, cur.title);
}

/** Toma número (si no tiene), publica el link y queda enviado. El email es aparte y opcional. */
async function publish(actor: BooksActor, cur: QuoteRow): Promise<QuoteRow> {
  if (!cur.contact_id) throw new BooksError('contact_required');
  if (cur.total <= 0) throw new BooksError('empty_document');
  const db = getDb();
  let number = cur.number;
  if (number == null) {
    for (let i = 0; i < 5 && number == null; i++) {
      const s = (await db.prepare('SELECT next_quote FROM books_settings WHERE workspace_id = ?').get(actor.ws)) as { next_quote: number };
      const n = Number(s.next_quote);
      const res = await db.prepare('UPDATE books_settings SET next_quote = ? WHERE workspace_id = ? AND next_quote = ?').run(n + 1, actor.ws, n);
      if (res.changes) number = n;
    }
    if (number == null) throw new BooksError('conflict', 409);
  }
  const ts = nowDb();
  await db
    .prepare("UPDATE books_quotes SET status = 'sent', number = ?, public_token = COALESCE(public_token, ?), public_revoked = 0, updated_at = ? WHERE id = ? AND status IN ('draft','sent')")
    .run(number, newToken(), ts, cur.id);
  return (await row(actor.ws, cur.id))!;
}

export function quoteUrl(token: string, locale = 'en'): string {
  const base = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
  return `${base}/${['es', 'pt'].includes(locale) ? locale : 'en'}/quote/${token}`;
}

const COPY = {
  en: { subject: 'Quote {n} from {from}', lead: '{from} sent you quote {n} for {total}.', view: 'View and accept the quote' },
  es: { subject: 'Presupuesto {n} de {from}', lead: '{from} te envió el presupuesto {n} por {total}.', view: 'Ver y aceptar el presupuesto' },
  pt: { subject: 'Orçamento {n} de {from}', lead: '{from} enviou o orçamento {n} de {total}.', view: 'Ver e aceitar o orçamento' },
} as const;

/** Sin email: deja el link listo para copiarlo. Con `email`: lo manda al email guardado del contacto. */
export async function sendQuote(actor: BooksActor, id: string, input: { email?: boolean; locale?: string } = {}): Promise<QuoteDto> {
  assertCan(actor, 'invoices.write');
  const cur = await row(actor.ws, id);
  if (!cur) throw new BooksError('not_found', 404);
  if (!['draft', 'sent'].includes(cur.status)) throw new BooksError('invalid_status', 409);
  const contact = await getContactRow(actor.ws, cur.contact_id);
  if (input.email) {
    const to = clean(contact?.email ?? '', 200).toLowerCase();
    if (!to) throw new BooksError('email_required');
    await assertBooksMailAllowed(actor.ws, to);
  }
  const fresh = await publish(actor, cur);
  if (input.email) {
    const s = await ensureBooks(actor.ws);
    const lang = (['en', 'es', 'pt'].includes(input.locale ?? '') ? input.locale : 'en') as keyof typeof COPY;
    const c = COPY[lang];
    const from = s.trade_name || s.legal_name || 'zerosoft';
    const fill = (x: string) => x.replace('{n}', quoteLabel(fresh.number)).replace('{from}', from).replace('{total}', formatMoney(fresh.total, fresh.currency, lang));
    const url = quoteUrl(fresh.public_token!, lang);
    const html = renderBrandedHtml({ heading: fill(c.subject), paragraphs: [escapeHtml(fill(c.lead)), `<a href="${escapeHtml(url)}">${escapeHtml(c.view)}</a>`], brandColor: s.brand_color, logoUrl: null, eyebrow: from });
    const res = await sendEmail({ to: contact!.email, subject: fill(c.subject), text: `${fill(c.lead)}\n\n${url}`, html, from: namedSender(from), ...(s.email ? { replyTo: s.email } : {}) });
    if (!res.ok) throw new BooksError('email_failed', 502);
    await getDb().prepare('UPDATE books_quotes SET sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?').run(nowDb(), nowDb(), id);
    await audit(actor, 'quote.send', 'quote', id, contact!.email);
  } else await audit(actor, 'quote.publish', 'quote', id, '');
  return (await getQuote(actor.ws, id))!;
}

export async function revokeQuoteLink(actor: BooksActor, id: string): Promise<QuoteDto> {
  assertCan(actor, 'invoices.write');
  const cur = await row(actor.ws, id);
  if (!cur) throw new BooksError('not_found', 404);
  await getDb().prepare('UPDATE books_quotes SET public_revoked = 1, updated_at = ? WHERE id = ?').run(nowDb(), id);
  await audit(actor, 'quote.revoke', 'quote', id, '');
  return (await getQuote(actor.ws, id))!;
}

/** Pasa a factura borrador una sola vez (compare-and-set sobre invoice_id). */
export async function quoteToInvoice(actor: BooksActor, id: string): Promise<DocDto> {
  assertCan(actor, 'invoices.write');
  const cur = await row(actor.ws, id);
  if (!cur) throw new BooksError('not_found', 404);
  if (cur.invoice_id) throw new BooksError('quote_invoiced', 409);
  if (!cur.contact_id) throw new BooksError('contact_required');
  const lines = parseJson<ResolvedLine[]>(cur.lines, []);
  const doc = await createDraft(
    actor,
    {
      docType: 'invoice',
      contactId: cur.contact_id,
      currency: cur.currency,
      fxRate: cur.fx_rate,
      taxInclusive: cur.tax_inclusive === 1,
      reference: cur.title || quoteLabel(cur.number),
      lines: lines.map((l) => ({ itemId: l.itemId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountBps: l.discountBps, taxRateId: l.taxRateId, accountId: l.accountId, trackingA: l.trackingA, trackingB: l.trackingB })),
    },
    { quote_id: cur.id },
  );
  const res = await getDb().prepare("UPDATE books_quotes SET status = 'invoiced', invoice_id = ?, updated_at = ? WHERE id = ? AND invoice_id IS NULL").run(doc.id, nowDb(), id);
  if (!res.changes) {
    await getDb().prepare("DELETE FROM books_documents WHERE id = ? AND status = 'draft'").run(doc.id);
    throw new BooksError('quote_invoiced', 409);
  }
  await audit(actor, 'quote.invoice', 'quote', id, doc.id);
  return doc;
}

// ---------- Vista pública ----------

export async function quoteByToken(token: string): Promise<{ ws: string; quote: QuoteDto } | null> {
  if (!token || token.length > 80 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const r = (await getDb().prepare("SELECT * FROM books_quotes WHERE public_token = ? AND public_revoked = 0 AND status != 'draft'").get(token)) as QuoteRow | undefined;
  return r ? { ws: r.workspace_id, quote: await toDto(r) } : null;
}

export async function markQuoteViewed(id: string): Promise<void> {
  await getDb().prepare('UPDATE books_quotes SET viewed_at = ? WHERE id = ? AND viewed_at IS NULL').run(nowDb(), id);
}

/** Decisión del cliente desde el link: una sola vez, y no sobre un presupuesto vencido. */
export async function decideQuote(token: string, decision: 'accepted' | 'declined', name: string): Promise<QuoteDto> {
  const found = await quoteByToken(token);
  if (!found) throw new BooksError('not_found', 404);
  if (found.quote.status === 'expired') throw new BooksError('quote_expired', 409);
  if (found.quote.status !== 'sent') throw new BooksError('quote_decided', 409);
  const who = clean(name, 120);
  if (decision === 'accepted' && !who) throw new BooksError('name_required');
  const ts = nowDb();
  const res = await getDb()
    .prepare("UPDATE books_quotes SET status = ?, decided_at = ?, decided_name = ?, updated_at = ? WHERE id = ? AND status = 'sent' AND public_revoked = 0")
    .run(decision, ts, who, ts, found.quote.id);
  if (!res.changes) throw new BooksError('quote_decided', 409);
  await audit({ ws: found.ws, person: null }, `quote.${decision}`, 'quote', found.quote.id, who);
  const { notifyStaff } = await import('./books-integrations');
  const { localized } = await import('./notification-copy');
  const label = found.quote.label;
  const title = decision === 'accepted'
    ? localized({ en: `Quote ${label} accepted`, es: `Presupuesto ${label} aceptado`, pt: `Orçamento ${label} aceito` })
    : localized({ en: `Quote ${label} declined`, es: `Presupuesto ${label} rechazado`, pt: `Orçamento ${label} recusado` });
  await notifyStaff(found.ws, title, localized({ en: found.quote.contactName, es: found.quote.contactName, pt: found.quote.contactName }), `/app/books/quotes/${found.quote.id}`, found.quote.id).catch(() => undefined);
  return (await getQuote(found.ws, found.quote.id))!;
}
