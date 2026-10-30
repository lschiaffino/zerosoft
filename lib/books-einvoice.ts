/**
 * Books: gancho de factura electrónica ante el fisco. Server-only.
 *
 * Interfaz de proveedor (EInvoiceProvider) y un proveedor de prueba que
 * funciona de punta a punta sin salir a internet. Los conectores reales de
 * ARCA (ex AFIP), SAT CFDI vía PAC e Invopop están declarados con las
 * credenciales que piden, pero NO implementados: autorizar con ellos
 * devuelve "provider_not_implemented". Ver docs/books-einvoicing.md.
 *
 * Las credenciales se guardan cifradas (lib/secret-box), por ambiente
 * (homologación y producción por separado), solo las cargan owner y admins,
 * nunca se devuelven ni se loguean.
 */
import { createHash } from 'crypto';
import { getDb } from './db';
import { audit, ensureBooks, getContactRow, getSeries, type SettingsRow } from './books';
import { docLines, getDocRow, getDocument, type DocDto, type DocRow } from './books-docs';
import { BooksError, clean, nowDb, parseJson, type BooksActor } from './books-schema';
import { addDays, docTotals, todayIso } from './books-money';
import { open as openSecret, seal } from './secret-box';

export type EInvoiceProviderId = 'test' | 'afip' | 'sat_cfdi' | 'invopop';
export const EINVOICE_PROVIDERS: readonly EInvoiceProviderId[] = ['test', 'afip', 'sat_cfdi', 'invopop'];
export type EInvoiceEnv = 'homologacion' | 'produccion';

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  /** Texto largo (certificados PEM). */
  multiline?: boolean;
}

/** Lo que el proveedor recibe: el comprobante ya emitido, con emisor y receptor. */
export interface EInvoiceDoc {
  docType: 'invoice' | 'credit_note';
  issuer: { legalName: string; taxId: string; taxCondition: string; country: string };
  receiver: { name: string; taxId: string; taxIdType: string; taxCondition: string; country: string };
  letter: string;
  pointOfSale: number;
  number: number;
  issueDate: string;
  currency: string;
  fxRate: string;
  byRate: Array<{ taxBps: number; net: number; tax: number }>;
  total: number;
  /** Factura original (para una nota de crédito). */
  relatedNumber?: string | null;
}

export type EInvoiceResult =
  | { status: 'authorized'; code: string; expiresAt: string | null; extra: Record<string, unknown> }
  | { status: 'rejected'; errors: Array<{ code: string; message: string }> };

export interface EInvoiceProvider {
  id: EInvoiceProviderId;
  name: string;
  country: 'AR' | 'MX' | null;
  implemented: boolean;
  credentials: CredentialField[];
  authorize(doc: EInvoiceDoc, ctx: { env: EInvoiceEnv; credentials: Record<string, string> }): Promise<EInvoiceResult>;
}

/**
 * Proveedor de prueba: CAE ficticio de 14 dígitos (derivado del comprobante,
 * así es estable), vence a 10 días. Rechaza una factura A cuyo receptor no
 * tiene identificación fiscal, como haría el fisco.
 */
export const testProvider: EInvoiceProvider = {
  id: 'test',
  name: 'Test provider (no fiscal validity)',
  country: null,
  implemented: true,
  credentials: [],
  async authorize(doc) {
    const errors: Array<{ code: string; message: string }> = [];
    if (doc.letter === 'A' && !doc.receiver.taxId) errors.push({ code: '10015', message: 'Letter A requires the receiver tax ID' });
    if (!doc.issuer.taxId) errors.push({ code: '10000', message: 'Issuer tax ID is missing' });
    if (doc.total <= 0) errors.push({ code: '10048', message: 'Total must be greater than zero' });
    if (errors.length) return { status: 'rejected', errors };
    const digest = createHash('sha256').update(`${doc.issuer.taxId}|${doc.letter}|${doc.pointOfSale}|${doc.number}|${doc.total}`).digest();
    let code = '7';
    for (let i = 0; code.length < 14; i++) code += String(digest[i % digest.length] % 10);
    return { status: 'authorized', code, expiresAt: addDays(doc.issueDate, 10), extra: { test: true } };
  },
};

function notImplemented(id: EInvoiceProviderId, name: string, country: 'AR' | 'MX' | null, credentials: CredentialField[]): EInvoiceProvider {
  return {
    id,
    name,
    country,
    implemented: false,
    credentials,
    async authorize() {
      throw new BooksError('provider_not_implemented', 501, { provider: id });
    },
  };
}

export const PROVIDERS: Record<EInvoiceProviderId, EInvoiceProvider> = {
  test: testProvider,
  afip: notImplemented('afip', 'ARCA (ex AFIP) · wsfe', 'AR', [
    { key: 'cuit', label: 'CUIT', secret: false },
    { key: 'alias', label: 'Certificate alias', secret: false },
    { key: 'certificate', label: 'Certificate (.crt, PEM)', secret: true, multiline: true },
    { key: 'privateKey', label: 'Private key (PEM)', secret: true, multiline: true },
  ]),
  sat_cfdi: notImplemented('sat_cfdi', 'SAT CFDI 4.0 · PAC', 'MX', [
    { key: 'rfc', label: 'RFC', secret: false },
    { key: 'regimen', label: 'Régimen fiscal', secret: false },
    { key: 'postalCode', label: 'Código postal (lugar de expedición)', secret: false },
    { key: 'csdCer', label: 'CSD .cer (base64)', secret: true, multiline: true },
    { key: 'csdKey', label: 'CSD .key (base64)', secret: true, multiline: true },
    { key: 'csdPassword', label: 'CSD password', secret: true },
    { key: 'pacUser', label: 'PAC user or API key', secret: true },
  ]),
  invopop: notImplemented('invopop', 'Invopop', null, [
    { key: 'apiKey', label: 'API key', secret: true },
    { key: 'workflowId', label: 'Workflow id', secret: false },
  ]),
};

interface StoredEInvoice {
  provider?: EInvoiceProviderId;
  env?: EInvoiceEnv;
  /** Por ambiente: los secretos sellados, el resto en claro. */
  credentials?: Partial<Record<EInvoiceEnv, Record<string, string>>>;
}

function stored(s: SettingsRow): StoredEInvoice {
  return parseJson<StoredEInvoice>(s.einvoice, {});
}

export interface EInvoiceView {
  provider: EInvoiceProviderId | null;
  env: EInvoiceEnv;
  implemented: boolean;
  providers: Array<{ id: EInvoiceProviderId; name: string; country: string | null; implemented: boolean; fields: Array<CredentialField & { set: boolean; value?: string }> }>;
}

export function einvoiceView(s: SettingsRow): EInvoiceView {
  const st = stored(s);
  const env = st.env ?? 'homologacion';
  return {
    provider: st.provider ?? null,
    env,
    implemented: st.provider ? PROVIDERS[st.provider].implemented : false,
    providers: EINVOICE_PROVIDERS.map((id) => {
      const p = PROVIDERS[id];
      const creds = st.provider === id ? (st.credentials?.[env] ?? {}) : {};
      return {
        id,
        name: p.name,
        country: p.country,
        implemented: p.implemented,
        // Los secretos solo dicen si están cargados; los demás se muestran.
        fields: p.credentials.map((f) => ({ ...f, set: Boolean(creds[f.key]), ...(f.secret ? {} : { value: creds[f.key] ?? '' }) })),
      };
    }),
  };
}

export async function saveEInvoice(actor: BooksActor, input: { provider: EInvoiceProviderId | null; env?: EInvoiceEnv; credentials?: Record<string, string> }): Promise<EInvoiceView> {
  if (!actor.admin) throw new BooksError('forbidden', 403);
  const s = await ensureBooks(actor.ws);
  const st = stored(s);
  if (input.provider !== null && !EINVOICE_PROVIDERS.includes(input.provider)) throw new BooksError('invalid_provider');
  const env: EInvoiceEnv = input.env === 'produccion' ? 'produccion' : input.env === 'homologacion' ? 'homologacion' : (st.env ?? 'homologacion');
  const next: StoredEInvoice = { provider: input.provider ?? undefined, env, credentials: input.provider === st.provider ? (st.credentials ?? {}) : {} };
  if (input.provider && input.credentials) {
    const p = PROVIDERS[input.provider];
    const cur = { ...(next.credentials?.[env] ?? {}) };
    for (const f of p.credentials) {
      const v = input.credentials[f.key];
      if (v === undefined || v === '') continue;
      const value = clean(v, f.multiline ? 20_000 : 200);
      cur[f.key] = f.secret ? seal(value) : value;
    }
    next.credentials = { ...next.credentials, [env]: cur };
  }
  await getDb().prepare('UPDATE books_settings SET einvoice = ?, updated_at = ? WHERE workspace_id = ?').run(JSON.stringify(next), nowDb(), actor.ws);
  await audit(actor, 'einvoice.update', 'settings', null, `${input.provider ?? 'none'} ${env}`);
  return einvoiceView((await ensureBooks(actor.ws))!);
}

async function buildDoc(ws: string, d: DocRow, s: SettingsRow): Promise<EInvoiceDoc> {
  const contact = await getContactRow(ws, d.contact_id);
  const series = await getSeries(ws, d.series_id);
  const lines = await docLines(d.id);
  const totals = docTotals(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unit_price, discountBps: l.discount_bps, taxBps: l.tax_bps })));
  const related = d.credit_for_id ? await getDocRow(ws, d.credit_for_id) : null;
  return {
    docType: d.doc_type === 'credit_note' ? 'credit_note' : 'invoice',
    issuer: { legalName: s.legal_name, taxId: s.tax_id, taxCondition: s.tax_condition, country: s.country },
    receiver: { name: contact?.name ?? '', taxId: contact?.tax_id ?? '', taxIdType: contact?.tax_id_type ?? '', taxCondition: contact?.tax_condition ?? '', country: contact?.country ?? '' },
    letter: series?.letter ?? '',
    pointOfSale: series?.point_of_sale ?? 1,
    number: d.number ?? 0,
    issueDate: d.issue_date,
    currency: d.currency,
    fxRate: d.fx_rate,
    byRate: totals.byRate,
    total: d.total,
    relatedNumber: related?.number_label ?? null,
  };
}

/**
 * Pide la autorización de una factura o nota de crédito emitida. Se reclama
 * con compare-and-set (einvoice_status → 'pending') para que dos clics no
 * pidan dos CAE; el resultado queda en la factura.
 */
export async function authorizeDocument(actor: BooksActor, docId: string): Promise<DocDto> {
  if (actor.role !== 'accountant') throw new BooksError('forbidden', 403);
  const s = await ensureBooks(actor.ws);
  const st = stored(s);
  if (!st.provider) throw new BooksError('einvoice_not_configured', 409);
  const provider = PROVIDERS[st.provider];
  const d = await getDocRow(actor.ws, docId);
  if (!d || d.doc_type === 'bill') throw new BooksError('not_found', 404);
  if (d.status === 'draft' || d.status === 'void') throw new BooksError('invalid_status', 409);
  if (d.einvoice_status === 'authorized') throw new BooksError('already_authorized', 409);
  const db = getDb();
  const claim = await db
    .prepare("UPDATE books_documents SET einvoice_status = 'pending', updated_at = ? WHERE id = ? AND (einvoice_status IS NULL OR einvoice_status = 'rejected' OR einvoice_status = 'error')")
    .run(nowDb(), d.id);
  if (!claim.changes) throw new BooksError('einvoice_in_progress', 409);
  const env = st.env ?? 'homologacion';
  const raw = st.credentials?.[env] ?? {};
  const credentials: Record<string, string> = {};
  for (const f of provider.credentials) if (raw[f.key]) credentials[f.key] = f.secret ? openSecret(raw[f.key]) : raw[f.key];
  let result: EInvoiceResult;
  try {
    result = await provider.authorize(await buildDoc(actor.ws, d, s), { env, credentials });
  } catch (err) {
    const code = err instanceof BooksError ? err.code : 'provider_error';
    await db.prepare("UPDATE books_documents SET einvoice_status = 'error', einvoice_data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify({ provider: provider.id, env, error: code, at: nowDb() }), nowDb(), d.id);
    await audit(actor, 'einvoice.error', d.doc_type, d.id, code);
    if (err instanceof BooksError) throw err;
    throw new BooksError('provider_error', 502);
  }
  const data =
    result.status === 'authorized'
      ? { provider: provider.id, env, code: result.code, expiresAt: result.expiresAt, authorizedAt: todayIso(), ...result.extra }
      : { provider: provider.id, env, errors: result.errors, at: nowDb() };
  await db.prepare('UPDATE books_documents SET einvoice_status = ?, einvoice_data = ?, updated_at = ? WHERE id = ?').run(result.status, JSON.stringify(data), nowDb(), d.id);
  await audit(actor, `einvoice.${result.status}`, d.doc_type, d.id, provider.id);
  return (await getDocument(actor.ws, d.id))!;
}
