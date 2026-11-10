/**
 * Calls: agenda. Server-only.
 *
 * Usa los calendarios que la persona ya conectó en Cal (Google Calendar u
 * Outlook, el mismo OAuth) por lib/voice-calendar.ts. Cada persona elige una
 * regla (todas las reuniones con link, solo con gente de afuera, solo con
 * deals abiertos, o a mano) y cada reunión tiene su interruptor, que gana.
 *
 * El cron mira el calendario de quien tiene una regla automática cada 10
 * minutos (reclamando la fila de calls_prefs) y deja las reuniones de las
 * próximas 24 horas como llamadas 'scheduled'. Un minuto antes del inicio las
 * pasa a 'queued' (compare-and-set) y manda el bot.
 */
import { getDb } from '../db';
import { listOwnerSpacePeople } from '../workspace';
import type { VoiceCalendarEvent } from '../voice-types';
import { getAutoJoin } from './settings';
import { attendeesHaveDeal } from './crm';
import { callsBlockedFor, dispatchCall } from './bot';
import {
  CallsError,
  DISPATCH_LEAD_MS,
  SYNC_WINDOW_MS,
  botSupports,
  hasExternalAttendee,
  newId,
  normalizeMeetUrl,
  nowIso,
  platformOf,
  shouldJoin,
  type AutoJoinRule,
  type CallStatus,
  type CallsActor,
  type JoinMode,
} from './types';

const db = () => getDb();
const SYNC_EVERY_MS = 10 * 60_000;
const MAX_LIVE_PER_PERSON = 2;
const MAX_LIVE_PER_WORKSPACE = 4;

export interface UpcomingEvent {
  key: string;
  title: string;
  startsAt: string;
  endsAt: string;
  attendees: Array<{ name: string; email: string }>;
  meetingUrl: string | null;
  platform: 'meet' | 'zoom' | 'teams' | null;
  supported: boolean;
  external: boolean;
  mode: JoinMode;
  willJoin: boolean;
  callId: string | null;
  status: CallStatus | null;
}

async function calendarEvents(ws: string, person: string, fresh = false): Promise<VoiceCalendarEvent[]> {
  const { listCalendarEvents } = await import('../voice-calendar');
  return listCalendarEvents({ workspaceId: ws, personId: person, bookingScope: person }, { fresh });
}

async function memberEmails(ws: string): Promise<Set<string>> {
  const people = await listOwnerSpacePeople(ws, {});
  return new Set(people.map((p) => p.email.toLowerCase()));
}

async function personEmail(person: string): Promise<string> {
  const row = (await db().prepare('SELECT email FROM users WHERE id = ?').get(person)) as { email: string } | undefined;
  return (row?.email ?? '').toLowerCase();
}

interface ExistingRow {
  id: string;
  event_key: string;
  status: CallStatus;
  join_mode: JoinMode;
}

async function existingFor(ws: string, person: string, keys: string[]): Promise<Map<string, ExistingRow>> {
  if (!keys.length) return new Map();
  const rows = (await db()
    .prepare(`SELECT id, event_key, status, join_mode FROM calls WHERE workspace_id = ? AND owner_id = ? AND event_key IN (${keys.map(() => '?').join(',')}) AND deleted_at IS NULL`)
    .all(ws, person, ...keys)) as unknown as ExistingRow[];
  return new Map(rows.map((r) => [r.event_key, r]));
}

/** Próximas reuniones de la persona (7 días) con lo que va a hacer el bot en cada una. */
export async function listUpcoming(actor: CallsActor): Promise<{ events: UpcomingEvent[]; rule: AutoJoinRule; calendarConnected: boolean }> {
  const [events, rule, members, connected] = await Promise.all([
    calendarEvents(actor.ws, actor.person).catch(() => [] as VoiceCalendarEvent[]),
    getAutoJoin(actor.ws, actor.person),
    memberEmails(actor.ws),
    calendarConnected(actor.person),
  ]);
  const now = Date.now();
  const future = events.filter((e) => Date.parse(e.endsAt) > now);
  const existing = await existingFor(actor.ws, actor.person, future.map((e) => e.key));
  const out: UpcomingEvent[] = [];
  for (const e of future) {
    const url = e.meetingUrl;
    const platform = platformOf(url);
    const supported = botSupports(platform);
    const external = hasExternalAttendee(e.attendees, actor.email, members);
    const row = existing.get(e.key);
    const mode = row?.join_mode ?? 'auto';
    // "Solo con deals" mira el CRM: solo para las de afuera y si la regla lo pide.
    const hasDeal = rule === 'deals' && external && supported && mode === 'auto' ? await attendeesHaveDeal(actor.ws, e.attendees).catch(() => false) : false;
    out.push({
      key: e.key,
      title: e.title,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      attendees: e.attendees,
      meetingUrl: url,
      platform,
      supported,
      external,
      mode,
      willJoin: row && ['queued', 'joining', 'waiting', 'recording'].includes(row.status) ? true : shouldJoin({ rule, mode, supported, external, hasDeal }),
      callId: row?.id ?? null,
      status: row?.status ?? null,
    });
  }
  return { events: out, rule, calendarConnected: connected };
}

async function calendarConnected(person: string): Promise<boolean> {
  const [{ googleCalendarConnected }, { outlookCalendarConnected }] = await Promise.all([import('../google-calendar'), import('../outlook-calendar')]);
  const [g, o] = await Promise.all([googleCalendarConnected(person).catch(() => false), outlookCalendarConnected(person).catch(() => false)]);
  return g || o;
}

/**
 * Deja (o actualiza) la llamada agendada de un evento. Solo toca filas en
 * 'scheduled', 'skipped' o 'cancelled': una llamada en curso o grabada no cambia.
 */
async function upsertScheduled(
  ws: string,
  person: string,
  e: VoiceCalendarEvent,
  willJoin: boolean,
  mode: JoinMode | null,
): Promise<string | null> {
  const url = normalizeMeetUrl(e.meetingUrl) ?? e.meetingUrl;
  const platform = platformOf(e.meetingUrl) ?? 'meet';
  const ts = nowIso();
  const existing = (await existingFor(ws, person, [e.key])).get(e.key);
  if (existing) {
    if (!['scheduled', 'skipped', 'cancelled'].includes(existing.status)) return existing.id;
    await db()
      .prepare(
        `UPDATE calls SET title = ?, meeting_url = ?, platform = ?, scheduled_at = ?, scheduled_end = ?, attendees = ?, will_join = ?,
           join_mode = COALESCE(?, join_mode), status = 'scheduled', updated_at = ? WHERE id = ?`,
      )
      .run(e.title.slice(0, 200), url, platform, e.startsAt, e.endsAt, JSON.stringify(e.attendees.slice(0, 100)), willJoin ? 1 : 0, mode, ts, existing.id);
    return existing.id;
  }
  if (!willJoin && (mode === null || mode === 'auto')) return null;
  const id = newId();
  await db()
    .prepare(
      `INSERT INTO calls (id, workspace_id, owner_id, title, source, platform, meeting_url, event_key, scheduled_at, scheduled_end, status, join_mode, will_join, attendees, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'bot', ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(id, ws, person, e.title.slice(0, 200), platform, url, e.key, e.startsAt, e.endsAt, mode ?? 'auto', willJoin ? 1 : 0, JSON.stringify(e.attendees.slice(0, 100)), ts, ts);
  return id;
}

/** Interruptor de una reunión: 'on' graba, 'off' no, 'auto' sigue la regla. */
export async function setEventMode(actor: CallsActor, key: string, mode: JoinMode): Promise<UpcomingEvent | null> {
  const { findCalendarEvent } = await import('../voice-calendar');
  const e = await findCalendarEvent({ workspaceId: actor.ws, personId: actor.person, bookingScope: actor.person }, key);
  if (!e) throw new CallsError('event_not_found', 404);
  const platform = platformOf(e.meetingUrl);
  if (mode === 'on' && !botSupports(platform)) throw new CallsError('unsupported_platform', 400);
  const rule = await getAutoJoin(actor.ws, actor.person);
  const external = hasExternalAttendee(e.attendees, actor.email, await memberEmails(actor.ws));
  const hasDeal = rule === 'deals' && external ? await attendeesHaveDeal(actor.ws, e.attendees).catch(() => false) : false;
  const willJoin = shouldJoin({ rule, mode, supported: botSupports(platform), external, hasDeal });
  await upsertScheduled(actor.ws, actor.person, e, willJoin, mode);
  const list = await listUpcoming(actor);
  return list.events.find((x) => x.key === key) ?? null;
}

/**
 * "Mandar el bot ya" a un link de Meet. Crea la llamada en 'queued' y la
 * despacha en el momento (si el bot no responde, la reintenta el cron).
 */
export async function sendBotNow(actor: CallsActor, input: { url: string; title?: string }): Promise<{ id: string }> {
  const platform = platformOf(input.url);
  if (!platform) throw new CallsError('invalid_meeting_url', 400);
  if (!botSupports(platform)) throw new CallsError('unsupported_platform', 400);
  const url = normalizeMeetUrl(input.url)!;
  const { botConfigured } = await import('./bot');
  if (!botConfigured()) throw new CallsError('bot_not_configured', 503);
  // Una sola vez el mismo link en vivo por persona (doble clic, dos pestañas).
  const live = (await db()
    .prepare("SELECT id FROM calls WHERE workspace_id = ? AND owner_id = ? AND meeting_url = ? AND status IN ('queued', 'joining', 'waiting', 'recording') AND deleted_at IS NULL LIMIT 1")
    .get(actor.ws, actor.person, url)) as { id: string } | undefined;
  if (live) return { id: live.id };
  // El bot es compartido: tope de reuniones en vivo por persona y por workspace.
  const counts = (await db()
    .prepare(
      "SELECT COUNT(*) AS ws, SUM(CASE WHEN owner_id = ? THEN 1 ELSE 0 END) AS mine FROM calls WHERE workspace_id = ? AND status IN ('queued', 'joining', 'waiting', 'recording') AND deleted_at IS NULL",
    )
    .get(actor.person, actor.ws)) as { ws: number; mine: number | null };
  if (Number(counts.mine ?? 0) >= MAX_LIVE_PER_PERSON || Number(counts.ws) >= MAX_LIVE_PER_WORKSPACE) throw new CallsError('too_many_live', 429);
  const id = newId();
  const ts = nowIso();
  const title = (input.title ?? '').trim().slice(0, 200) || `Google Meet · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  await db()
    .prepare(
      `INSERT INTO calls (id, workspace_id, owner_id, title, source, platform, meeting_url, scheduled_at, status, join_mode, will_join, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'bot', ?, ?, ?, 'queued', 'on', 1, ?, ?)`,
    )
    .run(id, actor.ws, actor.person, title, platform, url, ts, ts, ts);
  await dispatchCall(id).catch((err) => console.error('[calls] dispatch now', err instanceof Error ? err.message : 'error'));
  return { id };
}

/** Detener: sale de la reunión (si ya entró) o no va (si estaba en cola). */
export async function stopCall(actor: CallsActor, id: string): Promise<void> {
  const { getCallRow, canEditCall } = await import('./core');
  const row = await getCallRow(actor, id);
  if (!canEditCall(actor, row)) throw new CallsError('forbidden', 403);
  if (row.status === 'scheduled' || (row.status === 'queued' && !row.dispatched_at)) {
    await db().prepare("UPDATE calls SET status = 'cancelled', join_mode = 'off', will_join = 0, updated_at = ? WHERE id = ? AND status IN ('scheduled', 'queued')").run(nowIso(), id);
    return;
  }
  if (!['queued', 'joining', 'waiting', 'recording'].includes(row.status)) throw new CallsError('not_live', 409);
  const { stopBot } = await import('./bot');
  await stopBot(id);
  if (row.status !== 'recording') {
    // Todavía no grababa: no hay nada que subir.
    await db().prepare("UPDATE calls SET status = 'cancelled', bot_token_hash = NULL, updated_at = ? WHERE id = ? AND status IN ('queued', 'joining', 'waiting')").run(nowIso(), id);
  }
}

// ---------- Cron ----------

/** Mira los calendarios de quienes tienen una regla automática (o interruptores prendidos). */
export async function syncDueCalendars(opts: { now?: Date; budgetMs?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const due = new Date(now.getTime() - SYNC_EVERY_MS).toISOString();
  const people = (await db()
    .prepare(
      `SELECT workspace_id, person_id, auto_join, synced_at FROM calls_prefs
       WHERE auto_join != 'manual' AND (synced_at IS NULL OR synced_at < ?) AND (sync_claimed_at IS NULL OR sync_claimed_at < ?)
       ORDER BY synced_at IS NOT NULL, synced_at LIMIT 50`,
    )
    .all(due, due)) as Array<{ workspace_id: string; person_id: string; auto_join: AutoJoinRule; synced_at: string | null }>;
  let n = 0;
  for (const p of people) {
    if (Date.now() - started > (opts.budgetMs ?? 40_000)) break;
    const claim = await db()
      .prepare('UPDATE calls_prefs SET sync_claimed_at = ? WHERE workspace_id = ? AND person_id = ? AND (sync_claimed_at IS NULL OR sync_claimed_at < ?) AND (synced_at IS NULL OR synced_at < ?)')
      .run(now.toISOString(), p.workspace_id, p.person_id, due, due);
    if (!claim.changes) continue;
    try {
      await syncPerson(p.workspace_id, p.person_id, p.auto_join, now);
      n++;
    } catch (err) {
      console.error('[calls] sync person', err instanceof Error ? err.message : 'error');
    }
    await db().prepare('UPDATE calls_prefs SET synced_at = ?, sync_claimed_at = NULL WHERE workspace_id = ? AND person_id = ?').run(now.toISOString(), p.workspace_id, p.person_id);
  }
  return n;
}

export async function syncPerson(ws: string, person: string, rule: AutoJoinRule, now = new Date()): Promise<void> {
  // ¿Sigue en el workspace con Calls? Si no, no se le agenda nada.
  const people = await listOwnerSpacePeople(ws, { app: 'calls' });
  if (!people.some((p) => p.id === person)) return;
  // Calls apagada o restringida para ella en Apps del workspace: tampoco.
  if (await callsBlockedFor(ws, person)) return;
  const events = (await calendarEvents(ws, person, true)).filter((e) => {
    const start = Date.parse(e.startsAt);
    return Date.parse(e.endsAt) > now.getTime() && start < now.getTime() + SYNC_WINDOW_MS;
  });
  const members = new Set(people.map((p) => p.email.toLowerCase()));
  const email = await personEmail(person);
  const existing = await existingFor(ws, person, events.map((e) => e.key));
  for (const e of events) {
    const platform = platformOf(e.meetingUrl);
    const supported = botSupports(platform);
    const mode = existing.get(e.key)?.join_mode ?? 'auto';
    const external = hasExternalAttendee(e.attendees, email, members);
    const hasDeal = rule === 'deals' && external && supported && mode === 'auto' ? await attendeesHaveDeal(ws, e.attendees).catch(() => false) : false;
    const willJoin = shouldJoin({ rule, mode, supported, external, hasDeal });
    await upsertScheduled(ws, person, e, willJoin, null);
  }
  // Reuniones agendadas que ya no están en el calendario (canceladas o movidas lejos).
  const keys = new Set(events.map((e) => e.key));
  const scheduled = (await db()
    .prepare("SELECT id, event_key FROM calls WHERE workspace_id = ? AND owner_id = ? AND status = 'scheduled' AND scheduled_at < ? AND event_key IS NOT NULL")
    .all(ws, person, new Date(now.getTime() + SYNC_WINDOW_MS).toISOString())) as Array<{ id: string; event_key: string }>;
  for (const s of scheduled) {
    if (!keys.has(s.event_key)) await db().prepare("UPDATE calls SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'scheduled'").run(nowIso(), s.id);
  }
}

/** Reuniones que empiezan en menos de un minuto: a la cola y al bot. */
export async function dispatchDue(now = new Date()): Promise<number> {
  const soon = new Date(now.getTime() + DISPATCH_LEAD_MS).toISOString();
  const rows = (await db()
    .prepare("SELECT id FROM calls WHERE status = 'scheduled' AND will_join = 1 AND deleted_at IS NULL AND scheduled_at <= ? AND (scheduled_end IS NULL OR scheduled_end > ?) LIMIT 50")
    .all(soon, now.toISOString())) as Array<{ id: string }>;
  let n = 0;
  for (const r of rows) {
    const claim = await db().prepare("UPDATE calls SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'scheduled'").run(now.toISOString(), r.id);
    if (!claim.changes) continue;
    if ((await dispatchCall(r.id, now)) === 'sent') n++;
  }
  // Las que quedaron en cola por un bot ocupado o caído: otro intento.
  const retry = (await db().prepare("SELECT id FROM calls WHERE status = 'queued' AND dispatched_at IS NULL AND deleted_at IS NULL LIMIT 20").all()) as Array<{ id: string }>;
  for (const r of retry) if ((await dispatchCall(r.id, now)) === 'sent') n++;
  return n;
}
