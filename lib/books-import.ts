/**
 * Books: importar contactos e ítems desde CSV y exportar listados. El CSV se
 * trata como datos: se valida cada fila y una fila mala no frena las demás.
 * Server-only.
 */
import { assertCan, createContact, createItem, listContacts, listItems } from './books';
import { listDocuments } from './books-docs';
import { splitCsvLine } from './books-bank';
import { BooksError, type BooksActor, type DocType } from './books-schema';
import { rowsToCsv } from './books-reports';
import { toDecimalString } from './books-money';

export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;

export interface ImportResult {
  created: number;
  skipped: number;
  errors: Array<{ row: number; error: string }>;
}

/** Filas como objetos por encabezado (en minúsculas y sin espacios). Detecta coma, punto y coma o tab. */
export function parseCsvTable(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = [';', '\t', ','].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const head = splitCsvLine(lines[0], delim).map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  return lines.slice(1).map((l) => {
    const cells = splitCsvLine(l, delim);
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

const pick = (r: Record<string, string>, ...keys: string[]) => keys.map((k) => r[k]).find((v) => v !== undefined && v !== '') ?? '';

export async function importContactsCsv(actor: BooksActor, text: string): Promise<ImportResult> {
  assertCan(actor, 'contacts.write');
  const rows = parseCsvTable(text);
  if (!rows.length) throw new BooksError('csv_empty');
  if (rows.length > MAX_IMPORT_ROWS) throw new BooksError('too_many_rows', 413);
  const existing = new Set((await listContacts(actor.ws, { includeArchived: true, limit: 100_000 })).map((c) => c.name.toLowerCase()));
  const out: ImportResult = { created: 0, skipped: 0, errors: [] };
  for (const [i, r] of rows.entries()) {
    const name = pick(r, 'name', 'nombre', 'nome', 'contact', 'contactname');
    if (!name) {
      out.errors.push({ row: i + 2, error: 'invalid_name' });
      continue;
    }
    if (existing.has(name.toLowerCase())) {
      out.skipped++;
      continue;
    }
    const kindRaw = pick(r, 'kind', 'type', 'tipo').toLowerCase();
    const kind = /supp|prov|forn/.test(kindRaw) ? 'supplier' : /both|ambos/.test(kindRaw) ? 'both' : 'customer';
    try {
      await createContact(actor, { name, kind, email: pick(r, 'email', 'correo', 'emailaddress'), phone: pick(r, 'phone', 'telefono', 'teléfono', 'telefone'), taxId: pick(r, 'tax_id', 'taxid', 'cuit', 'rfc', 'cnpj'), address: pick(r, 'address', 'direccion', 'dirección', 'endereco', 'endereço'), country: pick(r, 'country', 'pais', 'país').slice(0, 2).toUpperCase() }, { syncCrm: false });
      existing.add(name.toLowerCase());
      out.created++;
    } catch (err) {
      out.errors.push({ row: i + 2, error: err instanceof BooksError ? err.code : 'invalid_row' });
    }
  }
  return out;
}

export async function importItemsCsv(actor: BooksActor, text: string): Promise<ImportResult> {
  assertCan(actor, 'items.write');
  const rows = parseCsvTable(text);
  if (!rows.length) throw new BooksError('csv_empty');
  if (rows.length > MAX_IMPORT_ROWS) throw new BooksError('too_many_rows', 413);
  const existing = new Set((await listItems(actor.ws, { includeArchived: true, limit: 100_000 })).map((c) => c.name.toLowerCase()));
  const out: ImportResult = { created: 0, skipped: 0, errors: [] };
  for (const [i, r] of rows.entries()) {
    const name = pick(r, 'name', 'nombre', 'nome', 'item', 'itemname');
    if (!name) {
      out.errors.push({ row: i + 2, error: 'invalid_name' });
      continue;
    }
    if (existing.has(name.toLowerCase())) {
      out.skipped++;
      continue;
    }
    const kindRaw = pick(r, 'kind', 'type', 'tipo').toLowerCase();
    try {
      await createItem(actor, { name, kind: /prod/.test(kindRaw) ? 'product' : 'service', sku: pick(r, 'sku', 'code', 'codigo', 'código'), description: pick(r, 'description', 'descripcion', 'descripción', 'descricao'), unit: pick(r, 'unit', 'unidad', 'unidade'), price: pick(r, 'price', 'precio', 'preco', 'preço', 'unitprice') || '0', cost: pick(r, 'cost', 'costo', 'custo', 'purchaseprice') || '0' });
      existing.add(name.toLowerCase());
      out.created++;
    } catch (err) {
      out.errors.push({ row: i + 2, error: err instanceof BooksError ? err.code : 'invalid_row' });
    }
  }
  return out;
}

export async function contactsCsv(ws: string): Promise<string> {
  const rows = await listContacts(ws, { limit: 100_000 });
  return rowsToCsv([['name', 'kind', 'email', 'phone', 'tax_id', 'tax_condition', 'address', 'country', 'currency', 'terms_days'], ...rows.map((c) => [c.name, c.kind, c.email, c.phone, c.taxId, c.taxCondition, c.address, c.country, c.currency ?? '', c.termsDays ?? ''])]);
}

export async function itemsCsv(ws: string): Promise<string> {
  const { ensureBooks } = await import('./books');
  const s = await ensureBooks(ws);
  const rows = await listItems(ws, { limit: 100_000 });
  return rowsToCsv([['name', 'kind', 'sku', 'description', 'unit', 'price', 'cost', 'currency'], ...rows.map((i) => [i.name, i.kind, i.sku, i.description, i.unit, toDecimalString(i.price, s.base_currency), toDecimalString(i.cost, s.base_currency), s.base_currency])]);
}

export async function documentsCsv(ws: string, docType: DocType): Promise<string> {
  const { items } = await listDocuments(ws, { docType, limit: 1000 });
  return rowsToCsv([['number', 'reference', 'contact', 'issue_date', 'due_date', 'status', 'currency', 'total', 'due'], ...items.map((d) => [d.numberLabel, d.reference, d.contactName, d.issueDate, d.dueDate ?? '', d.status, d.currency, toDecimalString(d.total, d.currency), toDecimalString(d.amountDue, d.currency)])]);
}
