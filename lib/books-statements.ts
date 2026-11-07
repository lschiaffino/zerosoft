/**
 * Books: estado de cuenta de un contacto y su portal (link sin login que se
 * puede revocar). El portal muestra solo documentos emitidos de ese contacto,
 * sin notas internas, sin datos de otros contactos. Server-only.
 */
import { getDb } from './db';
import { assertCan, audit, ensureBooks, getContactRow, type ContactRow } from './books';
import { BooksError, clean, newToken, nowDb, type BooksActor } from './books-schema';
import { formatMoney, isValidDate, todayIso, toDecimalString } from './books-money';
import { csvCell } from './books-reports';

export interface StatementEntry {
  date: string;
  kind: 'invoice' | 'credit_note' | 'bill' | 'payment';
  label: string;
  /** Suma a lo que debe (factura). */
  charge: number;
  /** Baja lo que debe (cobro, nota de crédito). */
  credit: number;
  balance: number;
  docId: string;
}

export interface StatementCurrency {
  currency: string;
  opening: number;
  entries: StatementEntry[];
  closing: number;
  outstanding: Array<{ id: string; label: string; issueDate: string; dueDate: string | null; total: number; due: number; overdue: boolean; publicToken: string | null }>;
}

export interface Statement {
  contactId: string;
  contactName: string;
  side: 'customer' | 'supplier';
  from: string;
  to: string;
  currencies: StatementCurrency[];
}

/**
 * Por moneda: saldo inicial, cada movimiento con saldo acumulado y saldo
 * final. Saldo = emitido − cobrado − notas de crédito, contando por la fecha
 * del movimiento; lo anulado no entra. Una nota con saldo sin aplicar queda
 * como crédito (saldo negativo).
 */
export async function contactStatement(ws: string, contactId: string, from: string, to: string, side: 'customer' | 'supplier' = 'customer'): Promise<Statement> {
  if (!isValidDate(from) || !isValidDate(to) || from > to) throw new BooksError('invalid_date');
  const contact = await getContactRow(ws, contactId);
  if (!contact) throw new BooksError('not_found', 404);
  const types = side === 'supplier' ? ['bill'] : ['invoice', 'credit_note'];
  const db = getDb();
  const docs = (await db
    .prepare(
      `SELECT id, doc_type, status, number_label, reference, issue_date, due_date, currency, total, paid_total, credited_total, public_token, public_revoked FROM books_documents
       WHERE workspace_id = ? AND contact_id = ? AND status NOT IN ('draft','void') AND doc_type IN (${types.map(() => '?').join(',')}) AND issue_date <= ? ORDER BY issue_date, created_at`,
    )
    .all(ws, contactId, ...types, to)) as Array<Record<string, unknown>>;
  const pays = (await db
    .prepare(
      `SELECT p.doc_id, p.amount, p.date, p.reference, d.number_label, d.currency FROM books_payments p JOIN books_documents d ON d.id = p.doc_id
       WHERE p.workspace_id = ? AND d.contact_id = ? AND d.doc_type IN (${types.map(() => '?').join(',')}) AND d.status != 'void' AND p.date <= ? ORDER BY p.date, p.created_at`,
    )
    .all(ws, contactId, ...types, to)) as Array<Record<string, unknown>>;
  type Raw = Omit<StatementEntry, 'balance'> & { currency: string };
  const raw: Raw[] = [];
  for (const d of docs) {
    const isCredit = d.doc_type === 'credit_note';
    raw.push({
      date: String(d.issue_date),
      kind: d.doc_type as Raw['kind'],
      label: String(d.number_label || d.reference),
      charge: isCredit ? 0 : Number(d.total),
      credit: isCredit ? Number(d.total) : 0,
      docId: String(d.id),
      currency: String(d.currency),
    });
  }
  for (const p of pays) raw.push({ date: String(p.date), kind: 'payment', label: String(p.number_label), charge: 0, credit: Number(p.amount), docId: String(p.doc_id), currency: String(p.currency) });
  raw.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'payment' ? 1 : 0) - (b.kind === 'payment' ? 1 : 0));
  const currencies = [...new Set(raw.map((r) => r.currency))].sort();
  return {
    contactId,
    contactName: contact.name,
    side,
    from,
    to,
    currencies: currencies.map((currency) => {
      const list = raw.filter((r) => r.currency === currency);
      let balance = 0;
      for (const r of list) if (r.date < from) balance += r.charge - r.credit;
      const opening = balance;
      const entries: StatementEntry[] = [];
      for (const r of list) {
        if (r.date < from) continue;
        balance += r.charge - r.credit;
        const { currency: _c, ...rest } = r;
        entries.push({ ...rest, balance });
      }
      const today = todayIso();
      const outstanding = docs
        .filter((d) => d.currency === currency && d.doc_type !== 'credit_note' && ['sent', 'partial', 'overdue'].includes(String(d.status)))
        .map((d) => ({
          id: String(d.id),
          label: String(d.number_label || d.reference),
          issueDate: String(d.issue_date),
          dueDate: (d.due_date as string) ?? null,
          total: Number(d.total),
          due: Number(d.total) - Number(d.paid_total) - Number(d.credited_total),
          overdue: Boolean(d.due_date && String(d.due_date) < today),
          publicToken: d.public_revoked ? null : ((d.public_token as string) ?? null),
        }))
        .filter((d) => d.due > 0);
      return { currency, opening, entries, closing: balance, outstanding };
    }),
  };
}

export function statementCsv(st: Statement): string {
  const rows: Array<Array<string | number>> = [['currency', 'date', 'type', 'number', 'charge', 'credit', 'balance']];
  for (const c of st.currencies) {
    rows.push([c.currency, st.from, 'opening', '', '', '', toDecimalString(c.opening, c.currency)]);
    for (const e of c.entries) rows.push([c.currency, e.date, e.kind, e.label, e.charge ? toDecimalString(e.charge, c.currency) : '', e.credit ? toDecimalString(e.credit, c.currency) : '', toDecimalString(e.balance, c.currency)]);
    rows.push([c.currency, st.to, 'closing', '', '', '', toDecimalString(c.closing, c.currency)]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

// ---------- Portal ----------

export interface PortalState {
  token: string | null;
}

export async function portalState(ws: string, contactId: string): Promise<PortalState> {
  const c = (await getContactRow(ws, contactId)) as (ContactRow & { portal_token?: string | null; portal_revoked?: number }) | null;
  return { token: c && c.portal_token && !c.portal_revoked ? c.portal_token : null };
}

/** Prende el link (uno nuevo cada vez) o lo revoca: el link anterior deja de abrir en el acto. */
export async function setPortal(actor: BooksActor, contactId: string, action: 'enable' | 'revoke'): Promise<PortalState> {
  assertCan(actor, 'invoices.write');
  const c = await getContactRow(actor.ws, contactId);
  if (!c) throw new BooksError('not_found', 404);
  if (action === 'revoke') await getDb().prepare('UPDATE books_contacts SET portal_revoked = 1, updated_at = ? WHERE id = ? AND workspace_id = ?').run(nowDb(), contactId, actor.ws);
  else await getDb().prepare('UPDATE books_contacts SET portal_token = ?, portal_revoked = 0, updated_at = ? WHERE id = ? AND workspace_id = ?').run(newToken(), nowDb(), contactId, actor.ws);
  await audit(actor, `portal.${action}`, 'contact', contactId, '');
  return portalState(actor.ws, contactId);
}

export async function contactByPortalToken(token: string): Promise<{ ws: string; contact: ContactRow } | null> {
  if (!token || token.length > 80 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const c = (await getDb().prepare('SELECT * FROM books_contacts WHERE portal_token = ? AND portal_revoked = 0 AND archived = 0').get(token)) as (ContactRow & { workspace_id: string }) | undefined;
  return c ? { ws: c.workspace_id, contact: c } : null;
}

export function portalUrl(token: string, locale = 'en'): string {
  const base = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
  return `${base}/${['es', 'pt'].includes(locale) ? locale : 'en'}/statement/${token}`;
}

const COPY = {
  en: { subject: 'Your statement from {from}', heading: 'Statement of account', lead: '{from} shared your statement. Your balance is {balance}.', view: 'Open your statement' },
  es: { subject: 'Tu estado de cuenta de {from}', heading: 'Estado de cuenta', lead: '{from} te compartió tu estado de cuenta. Tu saldo es {balance}.', view: 'Abrir el estado de cuenta' },
  pt: { subject: 'Seu extrato de {from}', heading: 'Extrato', lead: '{from} compartilhou seu extrato. Seu saldo é {balance}.', view: 'Abrir o extrato' },
} as const;

/** Manda el link del portal al email guardado del contacto (sin texto libre y con tope por destinatario). */
export async function sendStatement(actor: BooksActor, contactId: string, locale = 'en'): Promise<{ to: string }> {
  assertCan(actor, 'invoices.write');
  const c = await getContactRow(actor.ws, contactId);
  if (!c) throw new BooksError('not_found', 404);
  const to = clean(c.email, 200).toLowerCase();
  if (!to) throw new BooksError('email_required');
  let state = await portalState(actor.ws, contactId);
  if (!state.token) state = await setPortal(actor, contactId, 'enable');
  const { assertBooksMailAllowed } = await import('./books-mail-guard');
  await assertBooksMailAllowed(actor.ws, to);
  const s = await ensureBooks(actor.ws);
  const today = todayIso();
  const st = await contactStatement(actor.ws, contactId, '1970-01-01', today, 'customer');
  const main = st.currencies[0];
  const lang = (['en', 'es', 'pt'].includes(locale) ? locale : 'en') as keyof typeof COPY;
  const copy = COPY[lang];
  const from = s.trade_name || s.legal_name || 'zerosoft';
  const fill = (x: string) => x.replace('{from}', from).replace('{balance}', main ? formatMoney(main.closing, main.currency, lang) : formatMoney(0, s.base_currency, lang));
  const url = portalUrl(state.token!, lang);
  const { escapeHtml, namedSender, renderBrandedHtml, sendEmail } = await import('./email');
  const html = renderBrandedHtml({ heading: copy.heading, paragraphs: [escapeHtml(fill(copy.lead)), `<a href="${escapeHtml(url)}">${escapeHtml(copy.view)}</a>`], brandColor: s.brand_color, logoUrl: null, eyebrow: from });
  const res = await sendEmail({ to, subject: fill(copy.subject), text: `${fill(copy.lead)}\n\n${url}`, html, from: namedSender(from), ...(s.email ? { replyTo: s.email } : {}) });
  if (!res.ok) throw new BooksError('email_failed', 502);
  await audit(actor, 'portal.send', 'contact', contactId, to);
  return { to };
}
