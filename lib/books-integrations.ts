/**
 * Books: lo que conecta con el resto de la suite. Server-only.
 *
 * - CRM: los clientes de Books son empresas del CRM (se crean o se vinculan)
 *   y un presupuesto aceptado del CRM pasa a factura borrador.
 * - Shop: un pedido pagado se registra como factura emitida y cobrada
 *   (opcional, Ajustes › Integraciones), una sola vez por pedido.
 * - Flow: books.invoice.paid y books.invoice.overdue, solo para flows de
 *   alguien que hoy usa Books.
 * - Email (Resend): factura y recordatorios con el link público.
 *
 * Nada de lo que es aviso tira: el documento ya quedó guardado.
 */
import { getDb } from './db';
import { assertCan, audit, createContact, ensureBooks, getContactRow, listTaxRates, type SettingsRow } from './books';
import { approveDocument, createDraft, getDocRow, getDocument, publicUrl, recordPayment, type DocDto, type DocRow } from './books-docs';
import { BooksError, clean, nowDb, type BooksActor } from './books-schema';
import { docTotals, formatMoney, parseAmount, rescale, currencyDecimals } from './books-money';
import { escapeHtml, namedSender, renderBrandedHtml, sendEmail } from './email';
import { personAppAccess } from './api-auth';

function appUrl(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

/** ¿La persona usa Books en el workspace? (owner siempre). */
export async function personUsesBooks(ws: string, personId: string | null): Promise<boolean> {
  if (!personId) return false;
  if (personId === ws) return true;
  const access = await personAppAccess(ws, personId).catch(() => null);
  if (!access) return false;
  return access.role === 'owner' || access.apps === '*' || access.apps.includes('books');
}

// ---------- Flow ----------

export function invoicePayload(d: DocDto) {
  return {
    invoice: {
      id: d.id,
      number: d.numberLabel,
      status: d.status,
      contact: { id: d.contactId, name: d.contactName, email: d.contactEmail },
      currency: d.currency,
      total: d.total,
      amountDue: d.amountDue,
      issueDate: d.issueDate,
      dueDate: d.dueDate,
      url: `${appUrl()}/en/app/books/invoices/${d.id}`,
    },
  };
}

async function emit(ws: string, type: 'books.invoice.paid' | 'books.invoice.overdue', data: Record<string, unknown>): Promise<void> {
  try {
    const { emitEventSoon } = await import('./events');
    await emitEventSoon(ws, type, data, { audience: (creatorId) => personUsesBooks(ws, creatorId ?? ws) });
  } catch (err) {
    console.error('[books] event failed', err instanceof Error ? err.message : 'error');
  }
}

export async function notifyStaff(ws: string, title: string, body: string, href: string, sourceId: string): Promise<void> {
  try {
    const { listOwnerSpacePeople } = await import('./workspace');
    const { createNotification } = await import('./notifications');
    const people = await listOwnerSpacePeople(ws, { app: 'books' }).catch(() => []);
    const ids = [...new Set([ws, ...people.filter((p) => p.role === 'owner' || p.role === 'admin').map((p) => p.id)])];
    for (const userId of ids) await createNotification({ userId, type: 'books_invoice', title, body, href, sourceType: 'books_invoice', sourceId });
  } catch (err) {
    console.error('[books] notify failed', err instanceof Error ? err.message : 'error');
  }
}

export async function onInvoicePaid(ws: string, d: DocDto): Promise<void> {
  const last = d.payments[d.payments.length - 1];
  await emit(ws, 'books.invoice.paid', { ...invoicePayload(d), payment: last ? { amount: last.amount, method: last.method, date: last.date } : null });
  await notifyStaff(ws, `Invoice ${d.numberLabel} paid`, `${d.contactName} · ${formatMoney(d.total, d.currency)}`, `/app/books/invoices/${d.id}`, d.id);
}

export async function onInvoiceOverdue(ws: string, d: DocDto, daysOverdue: number): Promise<void> {
  await emit(ws, 'books.invoice.overdue', { ...invoicePayload(d), daysOverdue });
}

// ---------- Email ----------

const COPY = {
  en: {
    invoiceSubject: 'Invoice {n} from {from}',
    creditSubject: 'Credit note {n} from {from}',
    reminderSubject: 'Reminder: invoice {n} is due',
    heading: 'Invoice {n}',
    creditHeading: 'Credit note {n}',
    reminderHeading: 'Payment reminder',
    lead: '{from} sent you invoice {n} for {total}.',
    creditLead: '{from} sent you credit note {n} for {total}.',
    due: 'Due {date}.',
    reminder: 'Invoice {n} for {total} was due on {date}. The pending amount is {due}.',
    view: 'View and pay the invoice',
    viewOnly: 'View the document',
  },
  es: {
    invoiceSubject: 'Factura {n} de {from}',
    creditSubject: 'Nota de crédito {n} de {from}',
    reminderSubject: 'Recordatorio: vence la factura {n}',
    heading: 'Factura {n}',
    creditHeading: 'Nota de crédito {n}',
    reminderHeading: 'Recordatorio de pago',
    lead: '{from} te envió la factura {n} por {total}.',
    creditLead: '{from} te envió la nota de crédito {n} por {total}.',
    due: 'Vence el {date}.',
    reminder: 'La factura {n} por {total} venció el {date}. El saldo pendiente es {due}.',
    view: 'Ver y pagar la factura',
    viewOnly: 'Ver el comprobante',
  },
  pt: {
    invoiceSubject: 'Fatura {n} de {from}',
    creditSubject: 'Nota de crédito {n} de {from}',
    reminderSubject: 'Lembrete: a fatura {n} venceu',
    heading: 'Fatura {n}',
    creditHeading: 'Nota de crédito {n}',
    reminderHeading: 'Lembrete de pagamento',
    lead: '{from} enviou a fatura {n} de {total}.',
    creditLead: '{from} enviou a nota de crédito {n} de {total}.',
    due: 'Vence em {date}.',
    reminder: 'A fatura {n} de {total} venceu em {date}. O saldo pendente é {due}.',
    view: 'Ver e pagar a fatura',
    viewOnly: 'Ver o documento',
  },
} as const;

function fill(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function senderName(s: SettingsRow): string {
  return s.trade_name || s.legal_name || 'zerosoft';
}

/** Envía la factura (o el recordatorio) al email del contacto o al pedido, con el link público. */
export async function emailDocument(ws: string, d: DocRow, opts: { to?: string; message?: string; kind: 'document' | 'reminder'; locale?: string }): Promise<{ ok: boolean; to: string }> {
  const s = await ensureBooks(ws);
  const contact = await getContactRow(ws, d.contact_id);
  const to = clean(opts.to ?? contact?.email ?? '', 200).toLowerCase();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new BooksError('email_required');
  if (!d.public_token || d.public_revoked) throw new BooksError('public_link_revoked', 409);
  const locale = (opts.locale ?? (s.country === 'generic' ? 'en' : 'es')) as keyof typeof COPY;
  const c = COPY[locale in COPY ? locale : 'en'];
  const tag = locale === 'es' ? 'es-AR' : locale === 'pt' ? 'pt-BR' : 'en-US';
  const due = d.due_date ? new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d.due_date}T00:00:00Z`)) : '';
  const vars = {
    n: d.number_label,
    from: senderName(s),
    total: formatMoney(d.total, d.currency, locale),
    due: formatMoney(Math.max(0, d.total - d.paid_total - d.credited_total), d.currency, locale),
    date: due,
  };
  const url = publicUrl(d.public_token, locale);
  const isCredit = d.doc_type === 'credit_note';
  const subject = fill(opts.kind === 'reminder' ? c.reminderSubject : isCredit ? c.creditSubject : c.invoiceSubject, vars);
  const heading = fill(opts.kind === 'reminder' ? c.reminderHeading : isCredit ? c.creditHeading : c.heading, vars);
  const lead = fill(opts.kind === 'reminder' ? c.reminder : isCredit ? c.creditLead : c.lead, vars);
  const paragraphs = [escapeHtml(lead)];
  if (opts.kind === 'document' && !isCredit && due) paragraphs.push(escapeHtml(fill(c.due, vars)));
  if (opts.message?.trim()) paragraphs.push(escapeHtml(opts.message.trim().slice(0, 2000)).replace(/\n/g, '<br>'));
  paragraphs.push(`<a href="${escapeHtml(url)}">${escapeHtml(isCredit ? c.viewOnly : c.view)}</a>`);
  const logo = s.logo_url ? (s.logo_url.startsWith('/') ? `${appUrl()}${s.logo_url}` : s.logo_url) : null;
  const html = renderBrandedHtml({ heading, paragraphs, brandColor: s.brand_color, logoUrl: logo, eyebrow: senderName(s) });
  const text = [lead, opts.message?.trim() ?? '', url].filter(Boolean).join('\n\n');
  const res = await sendEmail({ to, subject, text, html, from: namedSender(senderName(s)), ...(s.email ? { replyTo: s.email } : {}) });
  return { ok: res.ok, to };
}

export async function sendDocument(actor: BooksActor, id: string, input: { to?: string; message?: string; locale?: string }): Promise<DocDto> {
  const d = await getDocRow(actor.ws, id);
  if (!d || d.doc_type === 'bill') throw new BooksError('not_found', 404);
  assertCan(actor, 'invoices.write');
  if (d.status === 'void') throw new BooksError('invalid_status', 409);
  let row = d;
  if (d.status === 'draft') {
    await approveDocument(actor, id);
    row = (await getDocRow(actor.ws, id))!;
  }
  const res = await emailDocument(actor.ws, row, { to: input.to, message: input.message, kind: 'document', locale: input.locale });
  if (!res.ok) throw new BooksError('email_failed', 502);
  await getDb().prepare('UPDATE books_documents SET sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?').run(nowDb(), nowDb(), id);
  await audit(actor, 'doc.send', d.doc_type, id, res.to);
  return (await getDocument(actor.ws, id))!;
}

// ---------- CRM ----------

/** Crea (o vincula por nombre) la empresa del CRM de un contacto de Books. */
export async function syncContactToCrm(actor: BooksActor, contactId: string): Promise<string | null> {
  const c = await getContactRow(actor.ws, contactId);
  if (!c || c.crm_company_id) return c?.crm_company_id ?? null;
  const { userCanUseApp } = await import('./workspace');
  const access = await personAppAccess(actor.ws, actor.person).catch(() => null);
  if (actor.person !== actor.ws && !(access && userCanUseApp({ role: access.role, apps: access.apps as '*' }, 'crm'))) return null;
  const db = getDb();
  const existing = (await db.prepare('SELECT id FROM crm_companies WHERE user_id = ? AND lower(name) = lower(?) LIMIT 1').get(actor.ws, c.name)) as { id: string } | undefined;
  let companyId = existing?.id ?? null;
  if (!companyId) {
    const { createCompany } = await import('./crm');
    const co = await createCompany(actor.ws, { name: c.name, phone: c.phone, country: c.country });
    companyId = co.id;
  }
  await db.prepare('UPDATE books_contacts SET crm_company_id = ?, updated_at = ? WHERE id = ?').run(companyId, nowDb(), c.id);
  return companyId;
}

/** Empresas del CRM que todavía no son contactos de Books (para importar). */
export async function crmCompaniesToImport(ws: string, q = ''): Promise<Array<{ id: string; name: string; country: string; domain: string }>> {
  const rows = (await getDb()
    .prepare(
      `SELECT id, name, country, domain FROM crm_companies c WHERE c.user_id = ? AND NOT EXISTS (SELECT 1 FROM books_contacts b WHERE b.workspace_id = c.user_id AND b.crm_company_id = c.id)
       ${q ? "AND c.name LIKE ? ESCAPE '\\'" : ''} ORDER BY c.name COLLATE NOCASE LIMIT 50`,
    )
    .all(...(q ? [ws, `%${q.replace(/[\\%_]/g, (x) => `\\${x}`)}%`] : [ws]))) as Array<{ id: string; name: string; country: string; domain: string }>;
  return rows;
}

export async function importCrmCompany(actor: BooksActor, companyId: string, kind: 'customer' | 'supplier' = 'customer') {
  assertCan(actor, 'contacts.write');
  const co = (await getDb().prepare('SELECT * FROM crm_companies WHERE id = ? AND user_id = ?').get(companyId, actor.ws)) as
    | { id: string; name: string; phone: string; country: string }
    | undefined;
  if (!co) throw new BooksError('not_found', 404);
  const existing = (await getDb().prepare('SELECT id FROM books_contacts WHERE workspace_id = ? AND crm_company_id = ?').get(actor.ws, co.id)) as { id: string } | undefined;
  if (existing) return (await import('./books')).getContact(actor.ws, existing.id);
  const contact = (await getDb()
    .prepare("SELECT email FROM crm_contacts WHERE user_id = ? AND company_id = ? AND email != '' ORDER BY created_at LIMIT 1")
    .get(actor.ws, co.id)) as { email: string } | undefined;
  const country = /^[A-Za-z]{2}$/.test(co.country ?? '') ? co.country.toUpperCase() : '';
  return createContact(actor, { kind, name: co.name, phone: co.phone ?? '', email: contact?.email ?? '', country, crmCompanyId: co.id }, { syncCrm: false });
}

/** Presupuestos del CRM aceptados (o enviados) que todavía no son factura. */
export async function quotesToInvoice(ws: string): Promise<Array<{ id: string; number: string; title: string; total: number; currency: string; recipient: string; status: string }>> {
  const rows = (await getDb()
    .prepare(
      `SELECT q.id, q.number, q.title, q.total, q.currency, q.recipient_company, q.recipient_name, q.status FROM crm_quotes q
       WHERE q.user_id = ? AND q.status IN ('accepted','sent') AND NOT EXISTS (SELECT 1 FROM books_documents d WHERE d.workspace_id = q.user_id AND d.quote_id = q.id)
       ORDER BY q.status = 'accepted' DESC, q.updated_at DESC LIMIT 50`,
    )
    .all(ws)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    number: String(r.number),
    title: String(r.title ?? ''),
    total: Number(r.total),
    currency: String(r.currency),
    recipient: String(r.recipient_company || r.recipient_name || ''),
    status: String(r.status),
  }));
}

/**
 * Presupuesto del CRM → factura borrador: mismo cliente (la empresa del deal
 * o la del destinatario, vinculada o creada), mismas líneas, moneda y
 * descuentos; la tasa de impuesto se busca por porcentaje entre las de Books.
 */
export async function invoiceFromQuote(actor: BooksActor, quoteId: string, opts: { fxRate?: string } = {}): Promise<DocDto> {
  assertCan(actor, 'invoices.write');
  const db = getDb();
  const q = (await db.prepare('SELECT * FROM crm_quotes WHERE id = ? AND user_id = ?').get(quoteId, actor.ws)) as Record<string, unknown> | undefined;
  if (!q) throw new BooksError('not_found', 404);
  if (!['accepted', 'sent'].includes(String(q.status))) throw new BooksError('quote_not_sent', 409);
  const already = (await db.prepare('SELECT id FROM books_documents WHERE workspace_id = ? AND quote_id = ?').get(actor.ws, quoteId)) as { id: string } | undefined;
  if (already) throw new BooksError('quote_already_invoiced', 409, { id: already.id });
  // Cliente: empresa del deal.
  const deal = (await db.prepare('SELECT company_id FROM crm_deals WHERE id = ? AND user_id = ?').get(String(q.deal_id), actor.ws).catch(() => undefined)) as { company_id: string | null } | undefined;
  let contactId: string | null = null;
  if (deal?.company_id) {
    const linked = (await db.prepare('SELECT id FROM books_contacts WHERE workspace_id = ? AND crm_company_id = ?').get(actor.ws, deal.company_id)) as { id: string } | undefined;
    contactId = linked?.id ?? (await importCrmCompany(actor, deal.company_id))?.id ?? null;
  }
  if (!contactId) {
    const name = clean(String(q.recipient_company || q.recipient_name || ''), 160);
    if (!name) throw new BooksError('contact_required');
    const byName = (await db.prepare('SELECT id FROM books_contacts WHERE workspace_id = ? AND lower(name) = lower(?)').get(actor.ws, name)) as { id: string } | undefined;
    contactId = byName?.id ?? (await createContact(actor, { kind: 'customer', name, email: String(q.recipient_email ?? '') })).id;
  }
  const currency = String(q.currency || 'USD').toUpperCase();
  const taxes = await listTaxRates(actor.ws);
  const items = JSON.parse(String(q.items ?? '[]')) as Array<{ name: string; description: string; quantity: number; unit_price: number; discount_pct: number; tax_pct: number }>;
  const lines = items.map((it) => {
    const bps = Math.round(Number(it.tax_pct || 0) * 100);
    const tax = taxes.find((t) => t.rate_bps === bps) ?? null;
    return {
      description: clean([it.name, it.description].filter(Boolean).join(' · '), 1000),
      quantity: Number(it.quantity) || 1,
      unitPrice: parseAmount(Number(it.unit_price) || 0, currency) ?? 0,
      discountBps: Math.round(Number(it.discount_pct || 0) * 100),
      taxRateId: tax?.id ?? null,
    };
  });
  const doc = await createDraft(
    actor,
    { docType: 'invoice', contactId, currency, fxRate: opts.fxRate, reference: `${String(q.number)}${q.title ? ` · ${String(q.title)}` : ''}`.slice(0, 120), notes: String(q.terms ?? '').slice(0, 4000), lines },
    { quote_id: quoteId },
  );
  await audit(actor, 'doc.from_quote', 'invoice', doc.id, String(q.number));
  return doc;
}

// ---------- Shop ----------

/** Monto de Shop (siempre en centavos, ×100) → unidades mínimas reales de la moneda. */
export function shopCentsToMinor(cents: number, currency: string): number {
  return currencyDecimals(currency) === 2 ? cents : rescale(cents, 'USD', currency);
}

/**
 * Líneas de la factura de un pedido de Shop con los totales exactos del
 * pedido (pura, exportada para los tests). Ítems y envío al neto; el
 * impuesto con la tasa de Books que coincide con la del pedido. Si ninguna
 * coincide, el impuesto va como una línea de ajuste sin tasa (y `warning`).
 * Lo que no cierra por redondeo va en una línea de ajuste (puede ser
 * negativa) para que el total sea exactamente el del pedido.
 */
export function shopOrderLines(
  o: { subtotal: number; discount: number; shipping: number; tax: number; total: number; taxIncluded: boolean; shippingName: string },
  items: Array<{ title: string; quantity: number; unit: number }>,
  tax: { id: string; rateBps: number } | null,
  accounts: { sales: string; shipping: string; tax: string },
): { lines: Array<{ description: string; quantity: number; unitPrice: number; taxRateId: string | null; discountBps?: number; accountId?: string }>; warning: string | null } {
  const lines: Array<{ description: string; quantity: number; unitPrice: number; taxRateId: string | null; discountBps?: number; accountId?: string }> = [];
  let warning: string | null = null;
  const useRate = o.tax > 0 && tax ? tax : null;
  if (o.tax > 0 && !tax) warning = 'tax_rate_not_found';
  const pct = o.discount > 0 && o.subtotal > 0 ? Math.round((o.discount / o.subtotal) * 10_000) : 0;
  for (const i of items) {
    const unitNet = o.taxIncluded && useRate ? Math.round((i.unit * 10_000) / (10_000 + useRate.rateBps)) : i.unit;
    lines.push({ description: i.title, quantity: i.quantity, unitPrice: unitNet, taxRateId: useRate?.id ?? null, discountBps: pct || undefined, accountId: accounts.sales });
  }
  if (o.shipping > 0) lines.push({ description: `Shipping${o.shippingName ? ` (${o.shippingName})` : ''}`, quantity: 1, unitPrice: o.shipping, taxRateId: null, accountId: accounts.shipping });
  // Impuesto sin tasa en Books: va a la cuenta de impuestos (débito fiscal), no a ventas. Si venía incluido en
  // los precios, una línea negativa en ventas lo saca de ahí, así las ventas no quedan infladas.
  if (o.tax > 0 && !useRate) {
    lines.push({ description: 'Sales tax (no matching rate in Books)', quantity: 1, unitPrice: o.tax, taxRateId: null, accountId: accounts.tax });
    if (o.taxIncluded) lines.push({ description: 'Tax included in prices', quantity: 1, unitPrice: -o.tax, taxRateId: null, accountId: accounts.sales });
  }
  const t = docTotals(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountBps: l.discountBps, taxBps: l.taxRateId ? (useRate?.rateBps ?? 0) : 0 })));
  const diff = o.total - t.total;
  if (diff !== 0) lines.push({ description: 'Rounding adjustment', quantity: 1, unitPrice: diff, taxRateId: null, accountId: accounts.sales });
  return { lines, warning };
}

/**
 * Pedido de Shop pagado → factura emitida y cobrada en Books (si el ajuste
 * está activo y el pedido es posterior a activarlo). Idempotente y seguro con
 * corridas a la vez: un índice único por pedido para la factura, aprobar con
 * compare-and-set y el cobro con referencia única. Si una corrida anterior
 * dejó el borrador sin aprobar o sin cobrar, la siguiente lo termina (el cron
 * horario reintenta). Los totales son los del pedido al centavo.
 *
 * Reembolsos y cancelaciones de Shop no se reflejan solos: se registran con
 * una nota de crédito.
 */
export async function postShopOrder(ws: string, orderId: string): Promise<string | null> {
  const s = await ensureBooks(ws);
  if (!s.shop_auto_post) return null;
  const db = getDb();
  const o = (await db.prepare('SELECT * FROM shop_orders WHERE id = ? AND workspace_id = ?').get(orderId, ws)) as Record<string, unknown> | undefined;
  if (!o || !o.paid_at) return null;
  if (s.shop_auto_post_since && String(o.paid_at) < s.shop_auto_post_since) return null;
  const currency = String(o.currency).toUpperCase();
  if (currency !== s.base_currency) return null; // Sin tipo de cambio no se registra: queda para hacerlo a mano.
  const actor: BooksActor = { ws, person: ws, admin: true, role: 'accountant' };
  const findDoc = async () => ((await db.prepare("SELECT id FROM books_documents WHERE workspace_id = ? AND shop_order_id = ? AND status != 'void'").get(ws, orderId)) as { id: string } | undefined)?.id ?? null;
  let docId = await findDoc();
  if (!docId) {
    const items = (await db.prepare('SELECT * FROM shop_order_items WHERE order_id = ?').all(orderId)) as Array<Record<string, unknown>>;
    const email = String(o.email ?? '').toLowerCase();
    const name = String(o.name || email || `Shop #${String(o.number)}`);
    const byEmail = email ? ((await db.prepare('SELECT id FROM books_contacts WHERE workspace_id = ? AND email = ? AND archived = 0').get(ws, email)) as { id: string } | undefined) : undefined;
    const contactId = byEmail?.id ?? (await createContact(actor, { kind: 'customer', name: clean(name, 160), email }, { syncCrm: false })).id;
    const included = Number(o.tax_included) === 1;
    const subtotal = shopCentsToMinor(Number(o.subtotal_cents), currency);
    const discount = shopCentsToMinor(Number(o.discount_cents), currency);
    const taxAmt = shopCentsToMinor(Number(o.tax_cents), currency);
    const net = included ? subtotal - discount - taxAmt : subtotal - discount;
    const rateBps = net > 0 && taxAmt > 0 ? Math.round((taxAmt / net) * 10_000) : 0;
    const taxes = await listTaxRates(ws);
    const tax = taxAmt > 0 ? (taxes.find((t) => t.rate_bps > 0 && Math.abs(t.rate_bps - rateBps) <= 5) ?? null) : null;
    const k = await (await import('./books-ledger')).keyAccounts(ws, ['sales', 'shipping_income', 'tax_out'] as const);
    const built = shopOrderLines(
      {
        subtotal,
        discount,
        shipping: shopCentsToMinor(Number(o.shipping_cents), currency),
        tax: taxAmt,
        total: shopCentsToMinor(Number(o.total_cents), currency),
        taxIncluded: included,
        shippingName: String(o.shipping_name ?? ''),
      },
      items.map((i) => ({ title: `${String(i.title)}${i.variant_title ? ` (${String(i.variant_title)})` : ''}`, quantity: Number(i.quantity), unit: shopCentsToMinor(Number(i.unit_cents), currency) })),
      tax ? { id: tax.id, rateBps: tax.rate_bps } : null,
      { sales: k.sales, shipping: k.shipping_income, tax: k.tax_out },
    );
    try {
      docId = (
        await createDraft(
          actor,
          { docType: 'invoice', contactId, currency, issueDate: String(o.paid_at).slice(0, 10), termsDays: 0, reference: `Shop #${String(o.number)}`, notes: built.warning ? 'The order tax has no matching rate in Books. It was posted to the sales tax account without a rate, so it does not appear by rate in the tax report.' : '', lines: built.lines },
          { shop_order_id: orderId },
          { allowNegativeLines: true },
        )
      ).id;
    } catch (err) {
      // Otra corrida la creó a la vez (índice único por pedido): seguimos con esa.
      if (!(err instanceof Error && /UNIQUE/i.test(err.message))) throw err;
      docId = await findDoc();
      if (!docId) return null;
    }
    if (built.warning) await notifyStaff(ws, `Shop order #${String(o.number)}: tax rate not found in Books`, `The tax went to the sales tax account without a rate. Add a ${rateBps / 100}% rate in Books › Settings › Taxes for future orders.`, `/app/books/invoices/${docId}`, docId);
  }
  // Aprobar (si quedó borrador) y cobrar (si quedó saldo): los dos idempotentes.
  let row = await getDocRow(ws, docId);
  if (row?.status === 'draft') {
    await approveDocument(actor, docId, { system: true }).catch((err) => {
      if (!(err instanceof BooksError && err.code === 'document_posted')) throw err;
    });
    row = await getDocRow(ws, docId);
  }
  if (row && ['sent', 'partial', 'overdue'].includes(row.status)) {
    const due = row.total - row.paid_total - row.credited_total;
    if (due > 0) {
      const method = o.payment_method === 'stripe' ? 'stripe' : o.payment_method === 'mercadopago' ? 'mercadopago' : 'bank';
      await recordPayment(actor, docId, { amount: due, date: row.issue_date, method, reference: `Shop #${String(o.number)}`, providerRef: `shop:${orderId}` }, { system: true });
    }
  }
  return docId;
}

/**
 * Cron: termina los pedidos que quedaron a medias (borrador sin aprobar,
 * emitido sin cobrar) o que no llegaron a registrarse (el hook falló), de
 * los workspaces con el registro automático activo.
 */
export async function retryShopPosting(opts: { limit?: number } = {}): Promise<{ retried: number; failed: number }> {
  const rows = (await getDb()
    .prepare(
      `SELECT o.id, o.workspace_id FROM shop_orders o JOIN books_settings s ON s.workspace_id = o.workspace_id AND s.shop_auto_post = 1
       WHERE o.paid_at IS NOT NULL AND (s.shop_auto_post_since IS NULL OR o.paid_at >= s.shop_auto_post_since) AND upper(o.currency) = s.base_currency
         AND o.status NOT IN ('cancelled')
         AND NOT EXISTS (SELECT 1 FROM books_documents d WHERE d.workspace_id = o.workspace_id AND d.shop_order_id = o.id AND d.status IN ('paid', 'void'))
       ORDER BY o.paid_at DESC LIMIT ?`,
    )
    .all(opts.limit ?? 50)) as Array<{ id: string; workspace_id: string }>;
  let retried = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      if (await postShopOrder(r.workspace_id, r.id)) retried++;
    } catch (err) {
      failed++;
      console.error('[books] shop retry', r.id, err instanceof Error ? err.message : err);
    }
  }
  return { retried, failed };
}

/** Hook de Shop: se llama al marcar un pedido pagado. Nunca tira. */
export async function onShopOrderPaid(ws: string, orderId: string): Promise<void> {
  try {
    // Solo si el workspace ya usa Books y activó el registro automático (no arma Books de rebote).
    const on = (await getDb().prepare('SELECT shop_auto_post FROM books_settings WHERE workspace_id = ?').get(ws)) as { shop_auto_post: number } | undefined;
    if (!on?.shop_auto_post) return;
    await postShopOrder(ws, orderId);
  } catch (err) {
    console.error('[books] shop order', err instanceof Error ? err.message : err);
  }
}

