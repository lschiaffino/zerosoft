/**
 * Books en ⌘K: facturas, notas de crédito y facturas de proveedor (número,
 * referencia o cliente), contactos, ítems, cuentas bancarias y recurrentes.
 * Respeta el rol de Books: sales no ve compras ni bancos.
 */
import { getDb } from './db';
import { booksActor } from './books';
import { can } from './books-roles';
import { likeEsc } from './books-schema';

export interface BooksSearchHit {
  id: string;
  group: 'booksInvoices' | 'booksCreditNotes' | 'booksBills' | 'booksContacts' | 'booksItems' | 'booksBankAccounts' | 'booksRecurring' | 'booksQuotes' | 'booksAssets' | 'booksBudgets';
  label: string;
  meta: string;
  href: string;
}

export async function searchBooks(user: { id: string; role?: string | null; actingUser?: { id: string } | null }, q: string): Promise<BooksSearchHit[]> {
  const exists = await getDb().prepare('SELECT 1 AS x FROM books_settings WHERE workspace_id = ?').get(user.id);
  if (!exists) return [];
  const actor = await booksActor({ ws: user.id, person: user.actingUser?.id ?? user.id, workspaceRole: user.role ?? 'owner' });
  const like = likeEsc(q.trim());
  const db = getDb();
  const out: BooksSearchHit[] = [];
  const types = [...(can(actor.role, 'invoices.read') ? ['invoice', 'credit_note'] : []), ...(can(actor.role, 'bills.read') ? ['bill'] : [])];
  if (types.length) {
    const docs = (await db
      .prepare(
        `SELECT d.id, d.doc_type, d.status, d.number_label, d.reference, c.name AS contact FROM books_documents d LEFT JOIN books_contacts c ON c.id = d.contact_id
         WHERE d.workspace_id = ? AND d.doc_type IN (${types.map(() => '?').join(',')})
         AND (d.number_label LIKE ? ESCAPE '\\' OR d.reference LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')
         ORDER BY d.updated_at DESC LIMIT 10`,
      )
      .all(user.id, ...types, like, like, like)) as Array<{ id: string; doc_type: string; status: string; number_label: string; reference: string; contact: string | null }>;
    for (const d of docs) {
      const group = d.doc_type === 'bill' ? 'booksBills' : d.doc_type === 'credit_note' ? 'booksCreditNotes' : 'booksInvoices';
      const path = d.doc_type === 'bill' ? 'bills' : d.doc_type === 'credit_note' ? 'credit-notes' : 'invoices';
      out.push({ id: `doc:${d.id}`, group, label: d.reference || d.number_label || d.contact || d.id, meta: [d.number_label, d.contact, d.status].filter(Boolean).join(' · '), href: `/app/books/${path}/${d.id}` });
    }
  }
  if (can(actor.role, 'contacts.read')) {
    const rows = (await db
      .prepare(
        `SELECT id, name, email, tax_id FROM books_contacts WHERE workspace_id = ? AND archived = 0 AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR tax_id LIKE ? ESCAPE '\\') ORDER BY name LIMIT 8`,
      )
      .all(user.id, like, like, like)) as Array<{ id: string; name: string; email: string; tax_id: string }>;
    for (const r of rows) out.push({ id: `con:${r.id}`, group: 'booksContacts', label: r.name, meta: [r.tax_id, r.email].filter(Boolean).join(' · '), href: `/app/books/contacts/${r.id}` });
  }
  if (can(actor.role, 'items.read')) {
    const rows = (await db
      .prepare(`SELECT id, name, sku FROM books_items WHERE workspace_id = ? AND archived = 0 AND (name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\') ORDER BY name LIMIT 8`)
      .all(user.id, like, like)) as Array<{ id: string; name: string; sku: string }>;
    for (const r of rows) out.push({ id: `itm:${r.id}`, group: 'booksItems', label: r.name, meta: r.sku, href: `/app/books/items/${r.id}` });
  }
  if (can(actor.role, 'banking.read')) {
    const rows = (await db
      .prepare(`SELECT id, name, bank_name FROM books_bank_accounts WHERE workspace_id = ? AND archived = 0 AND (name LIKE ? ESCAPE '\\' OR bank_name LIKE ? ESCAPE '\\') LIMIT 5`)
      .all(user.id, like, like)) as Array<{ id: string; name: string; bank_name: string }>;
    for (const r of rows) out.push({ id: `bnk:${r.id}`, group: 'booksBankAccounts', label: r.name, meta: r.bank_name, href: `/app/books/banking/${r.id}` });
  }
  if (can(actor.role, 'invoices.read')) {
    const quotes = (await db
      .prepare(
        `SELECT q.id, q.title, q.number, c.name AS contact FROM books_quotes q LEFT JOIN books_contacts c ON c.id = q.contact_id
         WHERE q.workspace_id = ? AND (q.title LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR ('Q-' || printf('%06d', q.number)) LIKE ? ESCAPE '\\') ORDER BY q.updated_at DESC LIMIT 5`,
      )
      .all(user.id, like, like, like)) as Array<{ id: string; title: string; number: number | null; contact: string | null }>;
    for (const r of quotes) {
      const label = r.number != null ? `Q-${String(r.number).padStart(6, '0')}` : '';
      out.push({ id: `quo:${r.id}`, group: 'booksQuotes', label: r.title || label || r.contact || r.id, meta: [label, r.contact].filter(Boolean).join(' · '), href: `/app/books/quotes/${r.id}` });
    }
  }
  if (can(actor.role, 'accounting.read')) {
    const assets = (await db.prepare(`SELECT id, name, reference FROM books_fixed_assets WHERE workspace_id = ? AND (name LIKE ? ESCAPE '\\' OR reference LIKE ? ESCAPE '\\') LIMIT 5`).all(user.id, like, like)) as Array<{ id: string; name: string; reference: string }>;
    for (const r of assets) out.push({ id: `ast:${r.id}`, group: 'booksAssets', label: r.name, meta: r.reference, href: `/app/books/fixed-assets/${r.id}` });
    const budgets = (await db.prepare(`SELECT id, name, start_month FROM books_budgets WHERE workspace_id = ? AND name LIKE ? ESCAPE '\\' LIMIT 5`).all(user.id, like)) as Array<{ id: string; name: string; start_month: string }>;
    for (const r of budgets) out.push({ id: `bud:${r.id}`, group: 'booksBudgets', label: r.name, meta: r.start_month, href: `/app/books/budgets/${r.id}` });
  }
  const recurringTypes = [...(can(actor.role, 'invoices.read') ? ['invoice'] : []), ...(can(actor.role, 'bills.read') ? ['bill'] : [])];
  if (recurringTypes.length) {
    const rows = (await db.prepare(`SELECT id, name, next_date FROM books_recurring WHERE workspace_id = ? AND doc_type IN (${recurringTypes.map(() => '?').join(',')}) AND name LIKE ? ESCAPE '\\' LIMIT 5`).all(user.id, ...recurringTypes, like)) as Array<{ id: string; name: string; next_date: string }>;
    for (const r of rows) out.push({ id: `rec:${r.id}`, group: 'booksRecurring', label: r.name, meta: r.next_date, href: `/app/books/recurring/${r.id}` });
  }
  return out;
}
