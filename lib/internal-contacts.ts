/**
 * Contactos internos (Lines e Inbox), como los de Periskope: teléfonos y
 * correos del equipo o de la empresa que no son clientes.
 *
 * - Regla del workspace (InternalSettings): los números conectados en Lines
 *   cuentan como internos (una línea que escribe en un grupo donde está otra
 *   línea es la empresa), y los correos de los dominios de la empresa.
 * - Por contacto (internal_contacts): marcar un teléfono o un correo como
 *   interno, o como "no interno" (la excepción a la regla automática).
 *
 * Lo interno no espera respuesta: un mensaje de alguien interno en un grupo
 * cuenta como respuesta del equipo (el chat deja de esperar y el ticket toma
 * su primera respuesta), no abre tickets por palabra clave ni pasa por el
 * modo "preguntas" ni por el agente por defecto, y no entra en las métricas
 * de clientes (Reportes de Lines, Analytics de Inbox). En la lista de
 * miembros y en quién escribió cada mensaje se ve "Interno", y hay un filtro.
 *
 * Por workspace (el id del dueño): lo ven igual todas las personas. Lo
 * administran los admins (las rutas lo exigen). Server-only.
 */
import { createHash, createHmac } from 'crypto';
import { getDb } from './db';
import { isPublicDomain } from './workspace';

export interface InternalSettings {
  /** Los números conectados en Lines cuentan como internos. */
  lines: boolean;
  /** Dominios de correo de la empresa (Inbox): sus direcciones son internas. */
  domains: string[];
}

export const DEFAULT_INTERNAL_SETTINGS: InternalSettings = { lines: true, domains: [] };

export const MAX_INTERNAL_CONTACTS = 2000;
export const MAX_INTERNAL_DOMAINS = 20;

const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const EMAIL = /^[^\s@]{1,64}@([a-z0-9.-]{3,253})$/;
const PHONE = /^\d{8,15}$/;

/** Un dominio limpio ("@Empresa.com " → "empresa.com"), o null. */
export function cleanDomain(raw: unknown): string | null {
  const d = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  return DOMAIN.test(d) ? d : null;
}

/** Un dominio que puede ser de la empresa: válido y no de correo gratis (gmail.com dejaría afuera a los clientes). */
export function companyDomain(raw: unknown): string | null {
  const d = cleanDomain(raw);
  return d && !isPublicDomain(d) ? d : null;
}

export function normalizeInternalSettings(raw: unknown): InternalSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const domains = Array.isArray(r.domains) ? [...new Set(r.domains.map(companyDomain).filter((d): d is string => !!d))].slice(0, MAX_INTERNAL_DOMAINS) : [];
  return { lines: r.lines !== false, domains };
}

/**
 * La forma guardada de un contacto: un correo en minúsculas, o los dígitos de
 * un teléfono (8 a 15, con o sin +, espacios o guiones). null si no es ninguno.
 */
export function normalizeHandle(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (s.includes('@') && !/@(s\.whatsapp\.net|c\.us)$/i.test(s)) {
    const e = s.toLowerCase();
    return EMAIL.test(e) && cleanDomain(e.split('@')[1]) ? e : null;
  }
  if (/@lid$/i.test(s)) return null;
  // Un JID ("<dígitos>:<dispositivo>@s.whatsapp.net") o un teléfono escrito: solo dígitos, +, espacios, guiones,
  // puntos y paréntesis ("Juan 1155550000" no es un teléfono). El 00 internacional es lo mismo que el +.
  const bare = s.replace(/@.*$/, '').replace(/:\d+$/, '');
  if (!/^[+\d\s().-]+$/.test(bare)) return null;
  const d = bare.replace(/\D/g, '').replace(/^00(?=\d{8})/, '');
  return PHONE.test(d) ? d : null;
}

export function handleKind(handle: string): 'phone' | 'email' {
  return handle.includes('@') ? 'email' : 'phone';
}

/** Sin secreto configurado: una clave fija solo sirve para desarrollo; en producción, error (la referencia se podría adivinar). */
function devFallback(value: string): string {
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') throw new Error('NEXTAUTH_SECRET is required');
  return value;
}

function secret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || devFallback('zerosoft-internal');
}

/** Referencia opaca de un contacto (para quien ve los teléfonos ocultos: lo saca de la lista sin ver el número). */
export function internalRef(ws: string, handle: string): string {
  return `int:${createHmac('sha256', secret()).update(`internal:${ws}:${handle}`).digest('hex').slice(0, 24)}`;
}

export async function getInternalSettings(ws: string): Promise<InternalSettings> {
  const row = (await getDb().prepare('SELECT data FROM internal_contact_settings WHERE workspace_id = ?').get(ws)) as { data: string } | undefined;
  if (!row) return { ...DEFAULT_INTERNAL_SETTINGS };
  try {
    return normalizeInternalSettings(JSON.parse(row.data));
  } catch {
    return { ...DEFAULT_INTERNAL_SETTINGS };
  }
}

export async function updateInternalSettings(ws: string, patch: Partial<InternalSettings>): Promise<InternalSettings> {
  const before = await getInternalSettings(ws);
  const next = normalizeInternalSettings({ ...before, ...patch });
  await getDb()
    .prepare(
      `INSERT INTO internal_contact_settings (workspace_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(ws, JSON.stringify(next), new Date().toISOString());
  // La regla de las líneas recién prendida: sus chats 1:1 que esperaban dejan de esperar.
  if (next.lines && !before.lines) {
    const set = await loadInternalSet(ws);
    await stopWaiting(ws, [...set.handles].filter((h) => handleKind(h) === 'phone'));
  }
  return next;
}

/**
 * La versión de lo interno del workspace (ajustes, contactos y las líneas de la regla): va primero en la versión
 * de las listas que responden 304 (Inbox) y en la caché de los reportes, así un cambio se ve ya. Una sola lectura.
 */
export async function internalVersion(ws: string): Promise<string> {
  // Solo los teléfonos que entran en la regla, en orden (el estado de conexión de una línea no cambia nada).
  const row = (await getDb()
    .prepare(
      `SELECT (SELECT updated_at FROM internal_contact_settings WHERE workspace_id = ?) AS s,
              (SELECT group_concat(phone) FROM (SELECT phone FROM groups_numbers WHERE user_id = ? AND phone <> '' AND provider <> 'sample' ORDER BY phone)) AS n`,
    )
    .get(ws, ws)) as { s: string | null; n: string | null } | undefined;
  return createHash('sha256').update(`${ws}|${row?.s ?? ''}|${row?.n ?? ''}`).digest('base64url').slice(0, 16);
}

async function touchInternal(ws: string, now: Date): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO internal_contact_settings (workspace_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET updated_at = excluded.updated_at`,
    )
    .run(ws, JSON.stringify(DEFAULT_INTERNAL_SETTINGS), now.toISOString());
}

/** Lo interno de un workspace, ya resuelto: se arma una vez por pedido (o por tanda de webhook). */
export interface InternalSet {
  /** Teléfonos (dígitos) y correos (minúsculas) internos: los marcados y, con la regla, los números de las líneas. */
  handles: Set<string>;
  /** Marcados "no interno": ganan a las reglas automáticas. */
  excluded: Set<string>;
  /** Dominios de la empresa (correos). */
  domains: string[];
}

export const EMPTY_INTERNAL_SET: InternalSet = { handles: new Set(), excluded: new Set(), domains: [] };

export async function loadInternalSet(ws: string): Promise<InternalSet> {
  const db = getDb();
  const [settings, rows] = await Promise.all([
    getInternalSettings(ws),
    db.prepare('SELECT handle, internal FROM internal_contacts WHERE workspace_id = ? LIMIT ?').all(ws, MAX_INTERNAL_CONTACTS) as Promise<Array<{ handle: string; internal: number }>>,
  ]);
  const handles = new Set<string>();
  const excluded = new Set<string>();
  for (const r of rows) (r.internal ? handles : excluded).add(r.handle);
  if (settings.lines) {
    // Las líneas del workspace (no las de ejemplo).
    const lines = (await db.prepare("SELECT phone FROM groups_numbers WHERE user_id = ? AND phone <> '' AND provider <> 'sample'").all(ws)) as Array<{ phone: string }>;
    for (const l of lines) {
      const d = normalizeHandle(l.phone);
      if (d && !excluded.has(d)) handles.add(d);
    }
  }
  return { handles, excluded, domains: settings.domains };
}

/**
 * ¿Ese teléfono es interno en el workspace? Como condición SQL, para decidirlo en la misma ida a la base que
 * guarda un mensaje (lib/groups.ts, saveInbound): las mismas reglas que isInternalHandle para un teléfono.
 * `phone` ya en dígitos ('' nunca es interno).
 */
export function internalPhoneSql(ws: string, phone: string): { sql: string; args: string[] } {
  return {
    sql: `(? <> '' AND NOT EXISTS (SELECT 1 FROM internal_contacts zix WHERE zix.workspace_id = ? AND zix.handle = ? AND zix.internal = 0)
      AND (EXISTS (SELECT 1 FROM internal_contacts zii WHERE zii.workspace_id = ? AND zii.handle = ? AND zii.internal = 1)
        OR (COALESCE((SELECT CASE WHEN json_valid(zis.data) THEN json_extract(zis.data, '$.lines') END FROM internal_contact_settings zis WHERE zis.workspace_id = ?), 1) <> 0
          AND EXISTS (SELECT 1 FROM groups_numbers zin WHERE zin.user_id = ? AND zin.phone = ? AND zin.provider <> 'sample'))))`,
    args: [phone, ws, phone, ws, phone, ws, ws, phone],
  };
}

/** ¿Es interno? Un teléfono (con o sin JID) o un correo. */
export function isInternalHandle(set: InternalSet, raw: string | null | undefined): boolean {
  const h = normalizeHandle(raw ?? '');
  if (!h || set.excluded.has(h)) return false;
  if (set.handles.has(h)) return true;
  if (!set.domains.length || !h.includes('@')) return false;
  return set.domains.includes(h.slice(h.lastIndexOf('@') + 1));
}

/** Los teléfonos internos (dígitos), para las consultas (`IN (SELECT value FROM json_each(?))`). */
export function internalPhonesJson(set: InternalSet): string {
  return JSON.stringify([...set.handles].filter((h) => !h.includes('@')));
}

/**
 * Condición SQL: la columna (un teléfono en dígitos o un correo) es de alguien
 * interno. `column` tiene que estar ya normalizada (dígitos o minúsculas).
 */
export function internalHandleSql(set: InternalSet, column: string): { sql: string; args: string[] } {
  const parts = [`${column} IN (SELECT value FROM json_each(?))`];
  const args = [JSON.stringify([...set.handles])];
  if (set.domains.length) {
    parts.push(
      `(instr(${column}, '@') > 0 AND substr(${column}, instr(${column}, '@') + 1) IN (SELECT value FROM json_each(?)) AND ${column} NOT IN (SELECT value FROM json_each(?)))`,
    );
    args.push(JSON.stringify(set.domains), JSON.stringify([...set.excluded]));
  }
  return { sql: `(${parts.join(' OR ')})`, args };
}

export interface InternalContactDto {
  /** Teléfono (dígitos, o enmascarado para quien no ve los números) o correo. */
  handle: string;
  ref: string;
  kind: 'phone' | 'email';
  internal: boolean;
  name: string;
  createdBy: string | null;
  createdAt: string;
  masked?: boolean;
}

export async function listInternalContacts(ws: string, opts: { mask?: boolean } = {}): Promise<InternalContactDto[]> {
  const rows = (await getDb()
    .prepare('SELECT handle, internal, name, created_by, created_at FROM internal_contacts WHERE workspace_id = ? ORDER BY internal DESC, created_at DESC LIMIT ?')
    .all(ws, MAX_INTERNAL_CONTACTS)) as Array<{ handle: string; internal: number; name: string; created_by: string | null; created_at: string }>;
  const { maskPhone } = await import('./groups-mask');
  return rows.map((r) => {
    const kind = handleKind(r.handle);
    const masked = !!opts.mask && kind === 'phone';
    return {
      handle: masked ? maskPhone(r.handle) : r.handle,
      ref: internalRef(ws, r.handle),
      kind,
      internal: r.internal === 1,
      name: r.name,
      createdBy: r.created_by,
      createdAt: r.created_at,
      ...(masked ? { masked: true } : {}),
    };
  });
}

/** El contacto guardado con esa referencia (la de la lista), o null. */
export async function handleForRef(ws: string, ref: string): Promise<string | null> {
  if (!/^int:[0-9a-f]{24}$/.test(ref)) return null;
  const rows = (await getDb().prepare('SELECT handle FROM internal_contacts WHERE workspace_id = ? LIMIT ?').all(ws, MAX_INTERNAL_CONTACTS)) as Array<{ handle: string }>;
  return rows.find((r) => internalRef(ws, r.handle) === ref)?.handle ?? null;
}

export class InternalContactError extends Error {
  constructor(
    public code: 'invalid_handle' | 'too_many' | 'invalid_domain',
    public status = 400,
  ) {
    super(code);
  }
}

/**
 * Marca un contacto: interno (true), no interno (false, la excepción a la
 * regla) o vuelve a la regla del workspace (null, saca la marca). Devuelve si
 * cambió algo.
 */
export async function setInternalContact(ws: string, actor: string | null, rawHandle: string, internal: boolean | null, name = '', now = new Date()): Promise<boolean> {
  const handle = normalizeHandle(rawHandle);
  if (!handle) throw new InternalContactError('invalid_handle');
  const db = getDb();
  if (internal === null) {
    const gone = (await db.prepare('DELETE FROM internal_contacts WHERE workspace_id = ? AND handle = ?').run(ws, handle)).changes > 0;
    if (gone) await touchInternal(ws, now);
    return gone;
  }
  const count = (await db.prepare('SELECT COUNT(*) AS n FROM internal_contacts WHERE workspace_id = ?').get(ws)) as { n: number };
  const exists = await db.prepare('SELECT 1 AS x FROM internal_contacts WHERE workspace_id = ? AND handle = ?').get(ws, handle);
  if (!exists && Number(count.n) >= MAX_INTERNAL_CONTACTS) throw new InternalContactError('too_many');
  const res = await db
    .prepare(
      `INSERT INTO internal_contacts (workspace_id, handle, internal, name, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, handle) DO UPDATE SET internal = excluded.internal,
         name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE internal_contacts.name END`,
    )
    .run(ws, handle, internal ? 1 : 0, name.replace(/\s+/g, ' ').trim().slice(0, 120), actor, now.toISOString());
  if (res.changes > 0) await touchInternal(ws, now);
  // Marcado como interno: sus chats 1:1 que esperaban respuesta dejan de esperar (no esperan al próximo mensaje).
  if (internal && handleKind(handle) === 'phone') await stopWaiting(ws, [handle]);
  return res.changes > 0;
}

/** Los chats 1:1 de Lines con esos teléfonos dejan de esperar respuesta (y de estar marcados como vencidos). */
export async function stopWaiting(ws: string, phones: string[]): Promise<void> {
  const list = phones.filter((p) => PHONE.test(p)).slice(0, MAX_INTERNAL_CONTACTS);
  if (!list.length) return;
  await getDb()
    .prepare(
      `UPDATE groups_chats SET awaiting_since = NULL, flagged_at = NULL
       WHERE user_id = ? AND kind = 'dm' AND awaiting_since IS NOT NULL AND phone IN (SELECT value FROM json_each(?))`,
    )
    .run(ws, JSON.stringify(list));
}
