/**
 * Cal — qué calendarios externos usa cada persona (como "Calendars to check
 * for conflicts" y "Add to calendar" de Calendly):
 *
 * - `google.check` / `outlook.check`: ids de calendarios cuyos eventos
 *   bloquean horarios (sin elegir: solo el principal);
 * - `write`: dónde se crea el evento de cada reserva (proveedor + calendario;
 *   sin elegir: el principal de Google si está conectado, si no el de Outlook).
 *
 * Se guarda en calendar_users.calendars de la persona (no del workspace).
 * Sin imports de lib/calendar.ts: lo usan google-calendar y outlook-calendar.
 */
import { getDb } from './db';

export type CalendarProvider = 'google' | 'outlook' | 'icloud';

export interface PersonCalendars {
  google?: { check?: string[] };
  outlook?: { check?: string[] };
  icloud?: { check?: string[] };
  write?: { provider: CalendarProvider; calendarId: string };
  /** Última vez que no se pudo crear el evento de una reserva (se limpia al volver a andar). */
  writeError?: { provider: CalendarProvider; at: string };
}

const MAX_CHECK = 20;

function ids(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 300);
  return [...new Set(out)].slice(0, MAX_CHECK);
}

/** JSON guardado → configuración válida (tolerante a datos rotos). */
export function parsePersonCalendars(json: string | null | undefined): PersonCalendars {
  let raw: unknown;
  try {
    raw = JSON.parse(json || '{}');
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, Record<string, unknown> | undefined>;
  const out: PersonCalendars = {};
  const gCheck = ids(r.google?.check);
  if (gCheck) out.google = { check: gCheck };
  const oCheck = ids(r.outlook?.check);
  if (oCheck) out.outlook = { check: oCheck };
  const iCheck = ids(r.icloud?.check);
  if (iCheck) out.icloud = { check: iCheck };
  const w = r.write;
  if (w && (w.provider === 'google' || w.provider === 'outlook' || w.provider === 'icloud') && typeof w.calendarId === 'string' && w.calendarId) {
    out.write = { provider: w.provider, calendarId: w.calendarId.slice(0, 500) };
  }
  const we = r.writeError as { provider?: unknown; at?: unknown } | undefined;
  if (we && (we.provider === 'google' || we.provider === 'outlook' || we.provider === 'icloud') && typeof we.at === 'string') {
    out.writeError = { provider: we.provider, at: we.at.slice(0, 40) };
  }
  return out;
}

export async function getPersonCalendars(personId: string): Promise<PersonCalendars> {
  const row = (await getDb().prepare('SELECT calendars FROM calendar_users WHERE user_id = ?').get(personId)) as
    | { calendars: string | null }
    | undefined;
  return parsePersonCalendars(row?.calendars);
}

/** Guarda (mezclando) la configuración de la persona; crea su fila de calendario si falta. */
export async function setPersonCalendars(personId: string, patch: PersonCalendars & { clearWrite?: boolean }): Promise<PersonCalendars> {
  const current = await getPersonCalendars(personId);
  const next: PersonCalendars = { ...current };
  if (patch.google) next.google = { check: ids(patch.google.check) ?? [] };
  if (patch.outlook) next.outlook = { check: ids(patch.outlook.check) ?? [] };
  if (patch.icloud) next.icloud = { check: ids(patch.icloud.check) ?? [] };
  if (patch.write) next.write = patch.write;
  if (patch.clearWrite) delete next.write;
  const clean = parsePersonCalendars(JSON.stringify(next));
  const exists = await getDb().prepare('SELECT 1 AS one FROM calendar_users WHERE user_id = ?').get(personId);
  const ts = new Date().toISOString();
  if (exists) {
    await getDb().prepare('UPDATE calendar_users SET calendars = ?, updated_at = ? WHERE user_id = ?').run(JSON.stringify(clean), ts, personId);
  } else {
    await getDb()
      .prepare(
        `INSERT INTO calendar_users
         (id, user_id, timezone, week_start, buffer_before_min, buffer_after_min, min_notice_hours, max_booking_days, created_at, updated_at, calendars)
         VALUES (?, ?, 'UTC', 1, 0, 0, 0, 30, ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), personId, ts, ts, JSON.stringify(clean));
  }
  return clean;
}

/** Anota si escribir el evento de una reserva anduvo (para avisar en Conexiones). */
export async function recordWriteResult(personId: string, provider: CalendarProvider, ok: boolean): Promise<void> {
  const cfg = await getPersonCalendars(personId);
  if (ok && !cfg.writeError) return;
  if (ok) {
    const next = { ...cfg };
    delete next.writeError;
    await getDb().prepare('UPDATE calendar_users SET calendars = ? WHERE user_id = ?').run(JSON.stringify(next), personId);
    return;
  }
  await getDb()
    .prepare('UPDATE calendar_users SET calendars = ? WHERE user_id = ?')
    .run(JSON.stringify({ ...cfg, writeError: { provider, at: new Date().toISOString() } }), personId);
}

/** Calendarios a revisar de un proveedor ('primary' / '' = el principal). */
export function checkedCalendars(cfg: PersonCalendars, provider: CalendarProvider): string[] {
  const list = cfg[provider]?.check;
  return list && list.length > 0 ? list : [provider === 'google' ? 'primary' : ''];
}

/**
 * Dónde se escribe el evento de una reserva, según lo conectado: lo elegido
 * si ese proveedor sigue conectado; si no, Google (principal) y si no Outlook.
 */
export function writeTarget(
  cfg: PersonCalendars,
  connected: { google: boolean; outlook: boolean; icloud?: boolean },
): { provider: CalendarProvider; calendarId: string } | null {
  if (cfg.write && connected[cfg.write.provider]) return cfg.write;
  if (connected.google) return { provider: 'google', calendarId: 'primary' };
  if (connected.outlook) return { provider: 'outlook', calendarId: '' };
  if (connected.icloud) return { provider: 'icloud', calendarId: '' };
  return null;
}
