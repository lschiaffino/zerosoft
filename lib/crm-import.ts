/**
 * CRM — import CSV de contactos, empresas y deals. Server-only.
 *
 * Las filas llegan ya mapeadas y saneadas por app/api/crm/import (sanitizeRows).
 * Además de los campos propios, cada entidad acepta:
 * - ownerEmail: email (o nombre completo, como exporta HubSpot) de una persona
 *   del workspace. Desconocido → aviso y queda el owner por defecto.
 * - custom: { name: valor crudo } de los custom fields de la entidad, que se
 *   convierten según su tipo (lo que no valida se descarta con aviso).
 * - Asociaciones: contactos → empresa (companyName/companyDomain, se crea si no
 *   existe, queda primaria); empresas → empresa madre (solo si existe); deals →
 *   empresa (se crea si no existe, primaria) y contactos por email (se crean).
 *
 * Los avisos van en `errors` con el prefijo "Row N:" igual que los errores.
 */
import { coerceCustomFieldValue } from './crm-custom-fields';
import { CrmRefError } from './crm-refs';
import { setParentCompany } from './crm-assoc';
import { getCrmSettings } from './crm-currency';
import { PRIORITIES, SOURCES } from './crm-constants';
import {
  createCompany,
  createContact,
  createDeal,
  listCustomFields,
  listPipelinesWithStages,
  moveDeal,
  parseCustom,
  updateCompany,
  updateContact,
  updateDeal,
} from './crm';
import {
  ensureMigrated,
  getClient,
  getDb,
  txDb,
  type CrmCustomFieldRow,
  type CrmImportPresetRow,
  type Db,
} from './db';

// ---------- Tipos ----------

export interface MappedContactRow {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  website?: string;
  city?: string;
  country?: string;
  lifecycleStage?: string;
  leadStatus?: string;
  source?: string;
  ownerEmail?: string;
  companyName?: string;
  companyDomain?: string;
  custom?: Record<string, string>;
}

export interface MappedCompanyRow {
  name?: string;
  domain?: string;
  industry?: string;
  employees?: number | null;
  phone?: string;
  website?: string;
  city?: string;
  country?: string;
  lifecycleStage?: string;
  ownerEmail?: string;
  parentCompanyName?: string;
  parentCompanyDomain?: string;
  custom?: Record<string, string>;
}

export interface MappedDealRow {
  name?: string;
  pipeline?: string;
  stage?: string;
  amount?: string | number;
  currency?: string;
  closeDate?: string;
  ownerEmail?: string;
  priority?: string;
  source?: string;
  description?: string;
  companyName?: string;
  companyDomain?: string;
  contactEmail?: string;
  custom?: Record<string, string>;
}

export type ImportMode = 'skip' | 'update';
export type ImportEntityName = 'contacts' | 'companies' | 'deals';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_FIND_RE = /[^\s@<>()"';,]+@[^\s@<>()"';,]+\.[^\s@<>()"';,]+/g;

function emptyResult(total: number): ImportResult {
  return { total, created: 0, updated: 0, skipped: 0, errors: [] };
}

async function recordImport(userId: string, entity: string, result: ImportResult, db: Db = getDb()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO crm_imports (id, user_id, entity, total, created, updated, skipped, errors)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      userId,
      entity,
      result.total,
      result.created,
      result.updated,
      result.skipped,
      JSON.stringify(result.errors),
    );
}

// ---------- Normalización (puro) ----------

const HUBSPOT_LIFECYCLE: Record<string, string> = {
  subscriber: 'subscriber',
  lead: 'lead',
  marketingqualifiedlead: 'mql',
  mql: 'mql',
  salesqualifiedlead: 'sql',
  sql: 'sql',
  opportunity: 'opportunity',
  customer: 'customer',
  evangelist: 'evangelist',
  other: 'lead',
};

const HUBSPOT_LEAD_STATUS: Record<string, string> = {
  new: 'new',
  open: 'open',
  inprogress: 'in_progress',
  opendeal: 'open_deal',
  unqualified: 'unqualified',
  attemptedtocontact: 'in_progress',
  connected: 'connected',
  badtiming: 'bad_timing',
};

const HUBSPOT_SOURCE: Record<string, string> = {
  organicsearch: 'organic',
  organic: 'organic',
  referrals: 'referral',
  referral: 'referral',
  paidsearch: 'ads',
  paidsocial: 'ads',
  ads: 'ads',
  socialmedia: 'social',
  organicsocial: 'social',
  social: 'social',
  emailmarketing: 'email',
  email: 'email',
  offlinesources: 'event',
  event: 'event',
  directtraffic: 'other',
  othercampaigns: 'other',
  other: 'other',
};

const norm = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Traduce valores de HubSpot ("Marketing Qualified Lead", "In Progress",
 * "Organic Search"…) a nuestros enums antes de validar. Lo demás pasa igual.
 */
export function normalizeImportValue(field: string, value: string): string {
  const n = norm(value);
  if (field === 'lifecycleStage') return HUBSPOT_LIFECYCLE[n] ?? value;
  if (field === 'leadStatus') return HUBSPOT_LEAD_STATUS[n] ?? value;
  if (field === 'source') return HUBSPOT_SOURCE[n] ?? value;
  return value;
}

/** "1,234.50", "1.234,50", "$1,234", "USD 1 234" → número (null si no es un monto). */
export function parseAmount(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = raw.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // El último separador es el decimal.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // Solo comas: decimal si hay una sola con 1-2 dígitos después; si no, miles.
    s = /^-?\d+,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function validYmd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Fecha → 'YYYY-MM-DD'. Acepta ISO (con hora), MM/DD/YYYY y DD/MM/YYYY cuando
 * no es ambiguo (un día > 12). Ambiguo → MM/DD (formato de los exports de HubSpot).
 */
export function parseImportDate(raw: string | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(v);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    if (a > 12) return validYmd(y, b, a);
    return validYmd(y, a, b);
  }
  return null;
}

/** Emails dentro de un texto ("Jane Doe (jane@x.com); bob@y.com"). */
export function extractEmails(raw: string | undefined): Array<{ email: string; name: string }> {
  const v = raw ?? '';
  const out: Array<{ email: string; name: string }> = [];
  const seen = new Set<string>();
  for (const part of v.split(/[;\n]/)) {
    const emails = part.match(EMAIL_FIND_RE) ?? [];
    for (const e of emails) {
      const email = e.toLowerCase();
      if (seen.has(email) || !EMAIL_RE.test(email)) continue;
      seen.add(email);
      const name = emails.length === 1 ? part.replace(e, '').replace(/[()<>"]/g, '').trim() : '';
      out.push({ email, name });
    }
  }
  return out;
}

/** Dominio limpio: sin protocolo, www, path ni mayúsculas. */
export function cleanDomain(raw: string | undefined): string {
  return (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');
}

// ---------- Contexto por import ----------

interface Person {
  id: string;
  email: string;
  name: string;
}

async function workspacePeople(userId: string, db: Db): Promise<Person[]> {
  return (await db
    .prepare(
      `SELECT id, email, COALESCE(name, '') AS name FROM users
       WHERE id = ? OR id IN (
         SELECT m.user_id FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ?)`,
    )
    .all(userId, userId)) as Person[];
}

function resolveOwner(
  people: Person[],
  value: string | undefined,
  rowNo: number,
  warnings: string[],
): string | undefined {
  const v = (value ?? '').trim();
  if (!v) return undefined;
  const lower = v.toLowerCase();
  const hit =
    people.find((p) => p.email.toLowerCase() === lower) ??
    people.find((p) => p.name && p.name.trim().toLowerCase() === lower);
  if (!hit) {
    warnings.push(`Row ${rowNo}: owner "${v}" not found, kept default`);
    return undefined;
  }
  return hit.id;
}

function parseOptions(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((o): o is string => typeof o === 'string') : [];
  } catch {
    return [];
  }
}

/** Convierte los valores crudos de custom fields según el tipo declarado. */
export function coerceCustom(
  defs: Pick<CrmCustomFieldRow, 'name' | 'type' | 'options'>[],
  raw: Record<string, string> | undefined,
  rowNo: number,
  warnings: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw) return out;
  for (const [name, value] of Object.entries(raw)) {
    const v = value.trim();
    if (!v) continue;
    const def = defs.find((d) => d.name === name);
    if (!def) continue;
    const bad = () => warnings.push(`Row ${rowNo}: invalid value "${v}" for ${name}, skipped`);
    switch (def.type) {
      case 'number': {
        const n = parseAmount(v);
        if (n === null) bad();
        else out[name] = n;
        break;
      }
      case 'boolean': {
        const n = norm(v);
        if (['yes', 'true', '1', 'si', 'sim', 'y'].includes(n)) out[name] = true;
        else if (['no', 'false', '0', 'nao', 'n'].includes(n)) out[name] = false;
        else bad();
        break;
      }
      case 'date': {
        const d = parseImportDate(v);
        if (!d) bad();
        else out[name] = d;
        break;
      }
      case 'select': {
        const opt = parseOptions(def.options).find((o) => o.toLowerCase() === v.toLowerCase());
        if (!opt) bad();
        else out[name] = opt;
        break;
      }
      case 'currency': {
        const n = parseAmount(v);
        if (n === null) bad();
        else out[name] = n;
        break;
      }
      case 'multiselect':
      case 'url':
      case 'phone': {
        // Multiselección: "A, B" sin importar mayúsculas contra las opciones.
        const value =
          def.type === 'multiselect'
            ? v
                .split(/[,;]/)
                .map((x) => parseOptions(def.options).find((o) => o.toLowerCase() === x.trim().toLowerCase()) ?? x.trim())
            : v;
        const coerced = coerceCustomFieldValue(def, value);
        if (coerced === undefined || coerced === null) bad();
        else out[name] = coerced;
        break;
      }
      case 'user':
        // Se importa el id tal cual: no hay un mapeo confiable de nombres a personas.
        out[name] = v.slice(0, 64);
        break;
      default:
        out[name] = v.slice(0, 500);
    }
  }
  return out;
}

/**
 * Empresa por dominio, si no por nombre (sin importar mayúsculas). Solo del
 * workspace. `create` la crea si no existe (con lo que haya: nombre y/o dominio).
 */
async function findCompany(
  userId: string,
  q: { name?: string; domain?: string },
  db: Db,
  create: boolean,
): Promise<{ id: string; created: boolean } | null> {
  const domain = cleanDomain(q.domain);
  const name = (q.name ?? '').trim();
  if (domain) {
    const row = (await db
      .prepare(`SELECT id FROM crm_companies WHERE user_id = ? AND domain != '' AND lower(domain) = ? LIMIT 1`)
      .get(userId, domain)) as { id: string } | undefined;
    if (row) return { id: row.id, created: false };
  }
  if (name) {
    const row = (await db
      .prepare('SELECT id FROM crm_companies WHERE user_id = ? AND lower(name) = lower(?) ORDER BY created_at LIMIT 1')
      .get(userId, name)) as { id: string } | undefined;
    if (row) return { id: row.id, created: false };
  }
  if (!create || (!name && !domain)) return null;
  const company = await createCompany(userId, { name: name || domain, domain }, db);
  return { id: company.id, created: true };
}

async function mergedCustom(
  db: Db,
  table: 'crm_contacts' | 'crm_companies' | 'crm_deals',
  id: string,
  next: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  if (!Object.keys(next).length) return undefined;
  const row = (await db.prepare(`SELECT custom FROM ${table} WHERE id = ?`).get(id)) as { custom: string } | undefined;
  return { ...parseCustom(row?.custom ?? null), ...next };
}

// ---------- Contacts ----------

/**
 * Importa contactos con dedupe por lower(email).
 * - email existente → mode 'update' actualiza los campos provistos; mode 'skip' lo salta.
 * - email vacío → siempre crea (no hay clave para deduplicar).
 * - email inválido → no se importa; queda en errors.
 * Todo en una transacción; graba el resumen en crm_imports.
 */
export async function importContacts(
  userId: string,
  rows: MappedContactRow[],
  mode: ImportMode,
): Promise<ImportResult> {
  const result = emptyResult(rows.length);
  const people = await workspacePeople(userId, getDb());
  const defs = await listCustomFields(userId, 'contacts');
  const unowned: string[] = [];
  await ensureMigrated();
  const tx = await getClient().transaction();
  const tdb = txDb(tx);
  try {
    const findByEmail = tdb.prepare(
      'SELECT id FROM crm_contacts WHERE user_id = ? AND lower(email) = lower(?) LIMIT 1',
    );
    for (const [i, raw] of rows.entries()) {
      const rowNo = i + 1;
      const { ownerEmail, companyName, companyDomain, custom: rawCustom, ...row } = raw;
      const email = (row.email ?? '').trim();
      if (email && !EMAIL_RE.test(email)) {
        result.errors.push(`Row ${rowNo}: invalid email "${email}"`);
        continue;
      }
      const existing = email
        ? ((await findByEmail.get(userId, email)) as { id: string } | undefined)
        : undefined;
      if (existing && mode === 'skip') {
        result.skipped++;
        continue;
      }
      const ownerId = resolveOwner(people, ownerEmail, rowNo, result.errors);
      const customVals = coerceCustom(defs, rawCustom, rowNo, result.errors);
      const company =
        companyName || companyDomain
          ? await findCompany(userId, { name: companyName, domain: companyDomain }, tdb, true)
          : null;
      const data = {
        ...row,
        email,
        ...(ownerId ? { ownerId } : {}),
        ...(company ? { companyId: company.id } : {}),
      };
      if (existing) {
        const custom = await mergedCustom(tdb, 'crm_contacts', existing.id, customVals);
        await updateContact(userId, existing.id, { ...data, ...(custom ? { custom } : {}) }, tdb);
        result.updated++;
      } else {
        const created = await createContact(userId, { ...data, custom: customVals }, tdb);
        if (!ownerId) unowned.push(created.id);
        result.created++;
      }
    }
    await recordImport(userId, 'contacts', result, tdb);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  // Round-robin (fuente "import") para los contactos nuevos sin owner en el CSV.
  if (unowned.length) {
    const { assignNewLead } = await import('./crm-assignment');
    for (const id of unowned) await assignNewLead(userId, id, 'import');
  }
  return result;
}

// ---------- Companies ----------

/** Importa empresas con dedupe por lower(domain). Misma semántica que importContacts. */
export async function importCompanies(
  userId: string,
  rows: MappedCompanyRow[],
  mode: ImportMode,
): Promise<ImportResult> {
  const result = emptyResult(rows.length);
  const people = await workspacePeople(userId, getDb());
  const defs = await listCustomFields(userId, 'companies');
  const parents: Array<{ id: string; rowNo: number; name?: string; domain?: string }> = [];
  await ensureMigrated();
  const tx = await getClient().transaction();
  const tdb = txDb(tx);
  try {
    const findByDomain = tdb.prepare(
      `SELECT id FROM crm_companies WHERE user_id = ? AND domain != '' AND lower(domain) = lower(?) LIMIT 1`,
    );
    for (const [i, raw] of rows.entries()) {
      const rowNo = i + 1;
      const { ownerEmail, parentCompanyName, parentCompanyDomain, custom: rawCustom, ...row } = raw;
      if (!(row.name ?? '').trim() && !(row.domain ?? '').trim()) {
        result.errors.push(`Row ${rowNo}: missing name and domain`);
        continue;
      }
      const domain = cleanDomain(row.domain);
      const existing = domain
        ? ((await findByDomain.get(userId, domain)) as { id: string } | undefined)
        : undefined;
      if (existing && mode === 'skip') {
        result.skipped++;
        continue;
      }
      const ownerId = resolveOwner(people, ownerEmail, rowNo, result.errors);
      const customVals = coerceCustom(defs, rawCustom, rowNo, result.errors);
      const data = { ...row, domain, ...(ownerId ? { ownerId } : {}) };
      let id: string;
      if (existing) {
        const custom = await mergedCustom(tdb, 'crm_companies', existing.id, customVals);
        await updateCompany(userId, existing.id, { ...data, ...(custom ? { custom } : {}) }, tdb);
        id = existing.id;
        result.updated++;
      } else {
        id = (await createCompany(userId, { ...data, custom: customVals }, tdb)).id;
        result.created++;
      }
      if (parentCompanyName || parentCompanyDomain) {
        parents.push({ id, rowNo, name: parentCompanyName, domain: parentCompanyDomain });
      }
    }
    // La madre puede venir más abajo en el mismo archivo: se resuelve al final.
    for (const p of parents) {
      const parent = await findCompany(userId, { name: p.name, domain: p.domain }, tdb, false);
      if (!parent || parent.id === p.id) {
        result.errors.push(`Row ${p.rowNo}: parent company "${p.domain || p.name}" not found, skipped`);
        continue;
      }
      try {
        await setParentCompany(userId, p.id, parent.id, tdb);
      } catch (e) {
        if (!(e instanceof CrmRefError)) throw e;
        result.errors.push(`Row ${p.rowNo}: parent company "${p.domain || p.name}" would create a cycle, skipped`);
      }
    }
    await recordImport(userId, 'companies', result, tdb);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  return result;
}

// ---------- Deals ----------

/**
 * Importa deals fila por fila (createDeal abre su propia transacción). Pipeline
 * y etapa por nombre (default: el primer pipeline y su primera etapa). En mode
 * 'update' se actualiza el deal con el mismo nombre en el mismo pipeline.
 */
export async function importDeals(userId: string, rows: MappedDealRow[], mode: ImportMode): Promise<ImportResult> {
  const result = emptyResult(rows.length);
  const db = getDb();
  const people = await workspacePeople(userId, db);
  const defs = await listCustomFields(userId, 'deals');
  const pipelines = await listPipelinesWithStages(userId);
  const { baseCurrency } = await getCrmSettings(userId, db);

  for (const [i, raw] of rows.entries()) {
    const rowNo = i + 1;
    try {
      if (!pipelines.length) {
        result.errors.push(`Row ${rowNo}: no pipeline in this workspace`);
        continue;
      }
      const name = (raw.name ?? '').trim();
      if (!name) {
        result.errors.push(`Row ${rowNo}: missing deal name`);
        continue;
      }
      let pipeline = pipelines[0];
      if (raw.pipeline?.trim()) {
        const hit = pipelines.find((p) => p.name.toLowerCase() === raw.pipeline!.trim().toLowerCase());
        if (hit) pipeline = hit;
        else result.errors.push(`Row ${rowNo}: pipeline "${raw.pipeline}" not found, used "${pipeline.name}"`);
      }
      if (!pipeline.stages.length) {
        result.errors.push(`Row ${rowNo}: pipeline "${pipeline.name}" has no stages`);
        continue;
      }
      let stage = pipeline.stages[0];
      if (raw.stage?.trim()) {
        const want = norm(raw.stage);
        const hit = pipeline.stages.find((s) => norm(s.name) === want);
        if (hit) stage = hit;
        else result.errors.push(`Row ${rowNo}: stage "${raw.stage}" not found, used "${stage.name}"`);
      }

      const amount = parseAmount(raw.amount);
      if (raw.amount !== undefined && raw.amount !== '' && amount === null) {
        result.errors.push(`Row ${rowNo}: invalid amount "${raw.amount}", skipped`);
      }
      const currency = /^[A-Za-z]{3}$/.test((raw.currency ?? '').trim())
        ? raw.currency!.trim().toUpperCase()
        : undefined;
      const closeDate = parseImportDate(raw.closeDate);
      if (raw.closeDate && !closeDate) result.errors.push(`Row ${rowNo}: invalid close date "${raw.closeDate}", skipped`);
      const priority = raw.priority && (PRIORITIES as readonly string[]).includes(raw.priority.toLowerCase())
        ? raw.priority.toLowerCase()
        : undefined;
      const source = raw.source ? normalizeImportValue('source', raw.source) : undefined;
      const ownerId = resolveOwner(people, raw.ownerEmail, rowNo, result.errors);
      const customVals = coerceCustom(defs, raw.custom, rowNo, result.errors);

      const existing =
        mode === 'update'
          ? ((await db
              .prepare(
                'SELECT id, stage_id FROM crm_deals WHERE user_id = ? AND pipeline_id = ? AND lower(name) = lower(?) LIMIT 1',
              )
              .get(userId, pipeline.id, name)) as { id: string; stage_id: string } | undefined)
          : undefined;

      // Asociaciones: empresa (se crea si falta) y contactos por email (se crean si faltan).
      const company =
        raw.companyName || raw.companyDomain
          ? await findCompany(userId, { name: raw.companyName, domain: raw.companyDomain }, db, true)
          : null;
      const contactIds: string[] = [];
      for (const { email, name: personName } of extractEmails(raw.contactEmail)) {
        const found = (await db
          .prepare('SELECT id FROM crm_contacts WHERE user_id = ? AND lower(email) = ? LIMIT 1')
          .get(userId, email)) as { id: string } | undefined;
        if (found) {
          contactIds.push(found.id);
          continue;
        }
        const [firstName, ...rest] = personName.split(/\s+/).filter(Boolean);
        const contact = await createContact(userId, {
          email,
          firstName: firstName ?? '',
          lastName: rest.join(' '),
          ...(company ? { companyId: company.id } : {}),
        });
        contactIds.push(contact.id);
      }
      if (raw.contactEmail?.trim() && !contactIds.length) {
        result.errors.push(`Row ${rowNo}: no valid email in "${raw.contactEmail}", contact not linked`);
      }

      const fields = {
        name,
        ...(amount !== null ? { amount: Math.max(amount, 0) } : {}),
        ...(currency ? { currency } : {}),
        ...(closeDate ? { closeDate } : {}),
        ...(priority ? { priority } : {}),
        ...(source && (SOURCES as readonly string[]).includes(source) ? { source } : {}),
        ...(raw.description ? { description: raw.description } : {}),
        ...(ownerId ? { ownerId } : {}),
        ...(company ? { companyId: company.id } : {}),
      };

      if (existing) {
        const custom = await mergedCustom(db, 'crm_deals', existing.id, customVals);
        await updateDeal(userId, existing.id, {
          ...fields,
          ...(custom ? { custom } : {}),
          ...(contactIds.length ? { addContactIds: contactIds } : {}),
        });
        if (raw.stage?.trim() && existing.stage_id !== stage.id) {
          await moveDeal(userId, existing.id, stage.id, null, undefined, '', { enforceRequired: false });
        }
        result.updated++;
        continue;
      }
      const created = await createDeal(userId, {
        ...fields,
        currency: currency ?? baseCurrency,
        pipelineId: pipeline.id,
        stageId: stage.id,
        contactIds,
        custom: customVals,
      });
      if (!created.ok) {
        result.errors.push(`Row ${rowNo}: ${created.reason}`);
        continue;
      }
      // Etapa ganada/perdida: el deal entra cerrado (fecha de cierre o ahora).
      if (stage.is_won || stage.is_lost) {
        await db
          .prepare('UPDATE crm_deals SET closed_at = ? WHERE id = ?')
          .run(
            closeDate ? `${closeDate} 00:00:00` : new Date().toISOString().slice(0, 19).replace('T', ' '),
            created.deal.id,
          );
      }
      result.created++;
    } catch (e) {
      if (e instanceof CrmRefError) {
        result.errors.push(`Row ${rowNo}: ${e.code}`);
        continue;
      }
      throw e;
    }
  }
  await recordImport(userId, 'deals', result, db);
  return result;
}

// ---------- Presets de mapeo ----------

export const IMPORT_ENTITIES: readonly ImportEntityName[] = ['contacts', 'companies', 'deals'];

export interface ImportPreset {
  id: string;
  entity: ImportEntityName;
  name: string;
  mapping: Record<string, string>;
  created_at: string;
}

function toPreset(row: CrmImportPresetRow): ImportPreset {
  return {
    id: row.id,
    entity: row.entity as ImportEntityName,
    name: row.name,
    mapping: parseCustom(row.mapping) as Record<string, string>,
    created_at: row.created_at,
  };
}

export async function listImportPresets(userId: string, entity?: ImportEntityName): Promise<ImportPreset[]> {
  const db = getDb();
  const rows = (entity
    ? await db
        .prepare('SELECT * FROM crm_import_presets WHERE user_id = ? AND entity = ? ORDER BY name COLLATE NOCASE')
        .all(userId, entity)
    : await db
        .prepare('SELECT * FROM crm_import_presets WHERE user_id = ? ORDER BY entity, name COLLATE NOCASE')
        .all(userId)) as CrmImportPresetRow[];
  return rows.map(toPreset);
}

export async function createImportPreset(
  userId: string,
  data: { entity: ImportEntityName; name: string; mapping: Record<string, string> },
): Promise<ImportPreset> {
  const mapping: Record<string, string> = {};
  for (const [h, f] of Object.entries(data.mapping).slice(0, 200)) {
    if (typeof f === 'string' && f) mapping[h.slice(0, 200)] = f.slice(0, 120);
  }
  const id = crypto.randomUUID();
  await getDb()
    .prepare('INSERT INTO crm_import_presets (id, user_id, entity, name, mapping) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, data.entity, data.name.trim().slice(0, 100), JSON.stringify(mapping));
  return toPreset(
    (await getDb().prepare('SELECT * FROM crm_import_presets WHERE id = ?').get(id)) as CrmImportPresetRow,
  );
}

export async function deleteImportPreset(userId: string, id: string): Promise<boolean> {
  return (
    (await getDb().prepare('DELETE FROM crm_import_presets WHERE id = ? AND user_id = ?').run(id, userId)).changes > 0
  );
}
