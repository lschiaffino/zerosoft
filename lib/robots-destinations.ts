/**
 * Robots — envíos al terminar una corrida exitosa (pestaña Integraciones).
 * Server-only.
 *
 *  - crm: crea o actualiza contactos (clave: email) o empresas (clave:
 *    dominio, o nombre si no hay dominio) del CRM del workspace, con el mapeo
 *    columna → campo. Corre con el acceso de quien armó el robot: si esa
 *    persona ya no es del workspace, el envío falla (owner_left).
 *  - sheets: Google Sheets API v4 con una credencial google / oauth_token de
 *    Credenciales. sync deja la hoja igual a la tabla acumulada (encabezado +
 *    filas activas); append agrega las filas nuevas o cambiadas de la corrida.
 *  - airtable: API de Airtable con un token personal (credencial oauth_token o
 *    api_key). Con campo clave hace upsert (performUpsert); sin él, crea.
 *
 * Filas: las nuevas o cambiadas de la tabla acumulada (si el envío usa esa
 * variable) o todas las de la variable de la corrida. Hasta 500 por envío
 * (sync: hasta 5.000). Todo el HTTP pasa por safeFetch.
 *
 * ROBOTS_DESTINATIONS_FAKE=1 (e2e, nunca en producción): Sheets y Airtable no
 * salen a internet; el resultado dice cuántas filas se hubieran mandado.
 */
import type { RobotRow } from './db';
import type { DatasetMergeResult } from './robots-dataset';
import { activeDatasetRows, rowsOf } from './robots-dataset';
import type { RobotDestination } from './robots-schema';
import { safeFetch } from './safe-fetch';

export interface DestinationResult {
  id: string;
  kind: RobotDestination['kind'];
  ok: boolean;
  /** Filas enviadas (creadas + actualizadas). */
  count: number;
  created?: number;
  updated?: number;
  skipped?: number;
  error?: string;
  fake?: boolean;
}

const MAX_ROWS = 500;
const MAX_SYNC_ROWS = 5000;
const TIMEOUT = 20_000;

export function destinationsFake(): boolean {
  return process.env.ROBOTS_DESTINATIONS_FAKE === '1' && process.env.VERCEL_ENV !== 'production';
}

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.slice(0, 5000);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v).slice(0, 5000);
  } catch {
    return '';
  }
};

class DestinationError extends Error {}

async function api(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await safeFetch(url, { ...init, headers: { 'user-agent': 'Zerosoft-Robots/1', ...(init.headers ?? {}) } }, TIMEOUT);
  } catch {
    throw new DestinationError('network_error');
  }
  const text = await res.text().catch(() => '');
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function credentialFor(workspaceId: string, name: string, types: readonly string[]) {
  const { resolveCredential } = await import('./flow-credentials');
  const cred = await resolveCredential(workspaceId, name);
  if (!cred) throw new DestinationError('missing_credential');
  if (!types.includes(cred.type)) throw new DestinationError('credential_type');
  return cred;
}

// ---------- CRM ----------

function domainFrom(v: string): string {
  const raw = v.trim().toLowerCase();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function sendToCrm(
  workspaceId: string,
  robot: Pick<RobotRow, 'created_by' | 'name'>,
  dest: Extract<RobotDestination, { kind: 'crm' }>,
  rows: Array<Record<string, unknown>>,
): Promise<Omit<DestinationResult, 'id' | 'kind'>> {
  const { isWorkspacePerson } = await import('./crm-refs');
  if (robot.created_by && !(await isWorkspacePerson(workspaceId, robot.created_by))) throw new DestinationError('owner_left');
  const crm = await import('./crm');
  const { getDb } = await import('./db');
  const pick = (row: Record<string, unknown>, field: string) => {
    const col = dest.mapping[field];
    return col ? cellText(row[col]).trim() : '';
  };
  const mode = dest.onExisting ?? 'fill';
  // Campos del robot que, en un registro existente, quedan sin tocar según el modo:
  // 'fill' solo completa lo vacío, 'overwrite' pisa todo. 'skip' no actualiza nada.
  const forExisting = (data: Record<string, string>, current: Record<string, unknown>, cols: Record<string, string>): Record<string, string> => {
    if (mode === 'overwrite') return data;
    const out: Record<string, string> = {};
    for (const [field, v] of Object.entries(data)) {
      const col = cols[field];
      const cur = col ? current[col] : undefined;
      if (cur === undefined || cur === null || String(cur).trim() === '') out[field] = v;
    }
    return out;
  };
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of rows.slice(0, MAX_ROWS)) {
    if (dest.object === 'contacts') {
      const email = pick(row, 'email').toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        skipped += 1;
        continue;
      }
      const data: Record<string, string> = {};
      for (const f of ['firstName', 'lastName', 'phone', 'jobTitle', 'website', 'city', 'country']) {
        const v = pick(row, f);
        if (v) data[f] = v.slice(0, 300);
      }
      const { findContactByEmail } = await import('./crm-integrations');
      const existing = await findContactByEmail(workspaceId, email);
      if (existing) {
        if (mode === 'skip') {
          skipped += 1;
          continue;
        }
        const patch = forExisting(data, existing as unknown as Record<string, unknown>, {
          firstName: 'first_name',
          lastName: 'last_name',
          phone: 'phone',
          jobTitle: 'job_title',
          website: 'website',
          city: 'city',
          country: 'country',
        });
        if (Object.keys(patch).length) await crm.updateContact(workspaceId, existing.id, patch);
        updated += 1;
      } else {
        await crm.createContact(workspaceId, { ...data, email, source: `robot:${robot.name}`.slice(0, 100) });
        created += 1;
      }
    } else {
      const name = pick(row, 'name').slice(0, 300);
      const domain = domainFrom(pick(row, 'domain') || pick(row, 'website'));
      if (!name && !domain) {
        skipped += 1;
        continue;
      }
      const data: Record<string, string> = {};
      for (const f of ['name', 'website', 'phone', 'industry', 'city', 'country']) {
        const v = pick(row, f);
        if (v) data[f] = v.slice(0, 300);
      }
      if (domain) data.domain = domain;
      const existing = (await getDb()
        .prepare(
          domain
            ? 'SELECT * FROM crm_companies WHERE user_id = ? AND lower(domain) = ? LIMIT 1'
            : 'SELECT * FROM crm_companies WHERE user_id = ? AND lower(name) = lower(?) LIMIT 1',
        )
        .get(workspaceId, domain || name)) as Record<string, unknown> | undefined;
      if (existing) {
        if (mode === 'skip') {
          skipped += 1;
          continue;
        }
        const patch = forExisting(data, existing, { name: 'name', website: 'website', phone: 'phone', industry: 'industry', city: 'city', country: 'country', domain: 'domain' });
        if (Object.keys(patch).length) await crm.updateCompany(workspaceId, String(existing.id), patch);
        updated += 1;
      } else {
        await crm.createCompany(workspaceId, data);
        created += 1;
      }
    }
  }
  return { ok: true, count: created + updated, created, updated, skipped };
}

// ---------- Google Sheets ----------

function toMatrix(rows: Array<Record<string, unknown>>, withHeader: boolean): string[][] {
  const head: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!head.includes(k) && head.length < 50) head.push(k);
  const body = rows.map((r) => head.map((h) => cellText(r[h])));
  return withHeader ? [head, ...body] : body;
}

async function sendToSheets(
  workspaceId: string,
  dest: Extract<RobotDestination, { kind: 'sheets' }>,
  rows: Array<Record<string, unknown>>,
  secrets: string[],
): Promise<Omit<DestinationResult, 'id' | 'kind'>> {
  const values = toMatrix(rows, dest.mode === 'sync');
  const count = dest.mode === 'sync' ? Math.max(values.length - 1, 0) : values.length;
  if (destinationsFake()) return { ok: true, count, fake: true };
  if (dest.mode === 'append' && !values.length) return { ok: true, count: 0 };
  const cred = await credentialFor(workspaceId, dest.credential, ['google', 'oauth_token']);
  const { googleToken, SHEETS_SCOPE } = await import('./flow-integrations');
  let token: string;
  try {
    token = cred.type === 'oauth_token' ? cred.data.accessToken : await googleToken({ addSecret: (s) => secrets.push(s) }, cred, SHEETS_SCOPE);
  } catch {
    throw new DestinationError('google_invalid_credential');
  }
  secrets.push(token);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(dest.spreadsheetId)}/values`;
  const range = encodeURIComponent(`${dest.sheet}!A1`);
  if (dest.mode === 'sync') {
    const clear = await api(`${base}/${encodeURIComponent(dest.sheet)}:clear`, { method: 'POST', headers, body: '{}' });
    if (clear.status >= 300) throw new DestinationError(`sheets_http_${clear.status}`);
    const put = await api(`${base}/${range}?valueInputOption=RAW`, { method: 'PUT', headers, body: JSON.stringify({ values }) });
    if (put.status >= 300) throw new DestinationError(`sheets_http_${put.status}`);
    return { ok: true, count };
  }
  const res = await api(`${base}/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ values }),
  });
  if (res.status >= 300) throw new DestinationError(`sheets_http_${res.status}`);
  return { ok: true, count };
}

// ---------- Airtable ----------

async function sendToAirtable(
  workspaceId: string,
  dest: Extract<RobotDestination, { kind: 'airtable' }>,
  rows: Array<Record<string, unknown>>,
  secrets: string[],
): Promise<Omit<DestinationResult, 'id' | 'kind'>> {
  const records = rows.slice(0, MAX_ROWS).map((r) => ({ fields: Object.fromEntries(Object.entries(r).slice(0, 50).map(([k, v]) => [k, cellText(v)])) }));
  if (destinationsFake()) return { ok: true, count: records.length, fake: true };
  if (!records.length) return { ok: true, count: 0 };
  const cred = await credentialFor(workspaceId, dest.credential, ['oauth_token', 'api_key']);
  const token = cred.type === 'oauth_token' ? cred.data.accessToken : cred.data.value;
  if (!token) throw new DestinationError('missing_credential');
  secrets.push(token);
  const url = `https://api.airtable.com/v0/${encodeURIComponent(dest.baseId)}/${encodeURIComponent(dest.table)}`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  let created = 0;
  let updated = 0;
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const body = dest.mergeField
      ? { records: batch, typecast: true, performUpsert: { fieldsToMergeOn: [dest.mergeField] } }
      : { records: batch, typecast: true };
    const res = await api(url, { method: dest.mergeField ? 'PATCH' : 'POST', headers, body: JSON.stringify(body) });
    if (res.status === 429) throw new DestinationError('airtable_rate_limited');
    if (res.status >= 300) throw new DestinationError(`airtable_http_${res.status}`);
    const b = (res.body ?? {}) as { createdRecords?: unknown[]; updatedRecords?: unknown[]; records?: unknown[] };
    if (dest.mergeField) {
      created += Array.isArray(b.createdRecords) ? b.createdRecords.length : 0;
      updated += Array.isArray(b.updatedRecords) ? b.updatedRecords.length : 0;
    } else {
      created += Array.isArray(b.records) ? b.records.length : batch.length;
    }
    // Airtable: 5 pedidos por segundo por base.
    if (i + 10 < records.length) await new Promise((r) => setTimeout(r, 250));
  }
  return { ok: true, count: created + updated, created, updated };
}

// ---------- Orquestación ----------

export async function runDestinations(opts: {
  workspaceId: string;
  robot: Pick<RobotRow, 'id' | 'created_by' | 'name'>;
  destinations: readonly RobotDestination[];
  vars: Record<string, unknown>;
  datasetVariable: string | null;
  dataset: DatasetMergeResult | null;
  /** Secretos derivados (tokens emitidos): se suman para redactar errores. */
  secrets: string[];
}): Promise<DestinationResult[]> {
  const out: DestinationResult[] = [];
  for (const dest of opts.destinations) {
    if (dest.enabled === false) continue;
    const variable = dest.variable || opts.datasetVariable || '';
    const fromDataset = !!opts.dataset && opts.dataset.variable === variable;
    try {
      let res: Omit<DestinationResult, 'id' | 'kind'>;
      if (dest.kind === 'sheets' && dest.mode === 'sync') {
        const rows = fromDataset ? await activeDatasetRows(opts.workspaceId, opts.robot.id, MAX_SYNC_ROWS) : rowsOf(opts.vars[variable]).slice(0, MAX_SYNC_ROWS);
        res = await sendToSheets(opts.workspaceId, dest, rows, opts.secrets);
      } else {
        const rows = fromDataset ? opts.dataset!.fresh : rowsOf(opts.vars[variable]);
        if (dest.kind === 'crm') res = await sendToCrm(opts.workspaceId, opts.robot, dest, rows);
        else if (dest.kind === 'sheets') res = await sendToSheets(opts.workspaceId, dest, rows, opts.secrets);
        else res = await sendToAirtable(opts.workspaceId, dest, rows, opts.secrets);
      }
      out.push({ id: dest.id, kind: dest.kind, ...res });
    } catch (err) {
      const code = err instanceof DestinationError ? err.message : 'destination_error';
      out.push({ id: dest.id, kind: dest.kind, ok: false, count: 0, error: code });
    }
  }
  return out;
}
