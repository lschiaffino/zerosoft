/**
 * Voice: el calendario de la persona para tomar notas (como Granola).
 * Server-only.
 *
 * Junta las reservas de Cal con los eventos de Google Calendar y Outlook que
 * la persona ya conectó en Cal (Cal › Ajustes › Calendarios: los mismos
 * calendarios que revisa para conflictos). Las reservas de Cal que Cal mismo
 * copió a Google u Outlook no se repiten. Cada evento lleva sus asistentes:
 * con eso se arma el brief previo y se vincula el contacto del CRM.
 */
import { getDb } from './db';
import { googleCalendarConnected, listGoogleEvents, type ExternalMeetingEvent } from './google-calendar';
import { listOutlookEvents, outlookCalendarConnected } from './outlook-calendar';
import { listUserBookings } from './calendar';
import type { VoiceOwner } from './voice';
import type { VoiceCalendarEvent } from './voice-types';

const cache = new Map<string, { at: number; events: VoiceCalendarEvent[] }>();
const TTL_MS = 60_000;

/**
 * ¿La persona atiende la reserva? Anfitriona (sin anfitrión explícito, el dueño
 * del tipo de evento, que es el workspace) o co-anfitriona.
 */
export function attendsBooking(b: { host_user_id: string | null; co_host_ids: string; event_type_user_id?: string }, owner: Pick<VoiceOwner, 'workspaceId' | 'personId'>): boolean {
  const host = b.host_user_id ?? b.event_type_user_id ?? owner.workspaceId;
  if (host === owner.personId) return true;
  try {
    const co: unknown = JSON.parse(b.co_host_ids || '[]');
    return Array.isArray(co) && co.includes(owner.personId);
  } catch {
    return false;
  }
}

/** Ventana por defecto: desde hace 1 hora hasta dentro de 7 días. */
export function defaultWindow(now = new Date()): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - 3_600_000), to: new Date(now.getTime() + 7 * 86_400_000) };
}

export function eventKey(provider: VoiceCalendarEvent['provider'], id: string): string {
  return `${provider}:${id}`;
}

export function parseEventKey(key: string): { provider: VoiceCalendarEvent['provider']; id: string } | null {
  const m = /^(cal|google|outlook):(.{1,512})$/.exec(key);
  return m ? { provider: m[1] as VoiceCalendarEvent['provider'], id: m[2] } : null;
}

function fromExternal(provider: 'google' | 'outlook', e: ExternalMeetingEvent): VoiceCalendarEvent {
  return {
    key: eventKey(provider, e.id),
    provider,
    title: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    attendees: e.attendees,
    meetingUrl: e.meetingUrl,
    sessionId: null,
  };
}

/**
 * Eventos de la persona en la ventana, ordenados por inicio. Un proveedor que
 * falla no corta la lista (cada uno es best-effort). Cache de 60 s por persona.
 */
export async function listCalendarEvents(owner: VoiceOwner, opts: { now?: Date; fresh?: boolean } = {}): Promise<VoiceCalendarEvent[]> {
  const now = opts.now ?? new Date();
  // Conectar o desconectar un calendario cambia la clave: la lista se vuelve a pedir enseguida.
  const [g, o] = await Promise.all([googleCalendarConnected(owner.personId).catch(() => false), outlookCalendarConnected(owner.personId).catch(() => false)]);
  const key = `${owner.workspaceId}:${owner.personId}:${g ? 'g' : ''}${o ? 'o' : ''}`;
  const hit = cache.get(key);
  let events = !opts.fresh && hit && Date.now() - hit.at < TTL_MS ? hit.events : null;
  if (!events) {
    const { from, to } = defaultWindow(now);
    const [bookings, google, outlook] = await Promise.all([
      // Siempre las que atiende la persona (anfitriona o co-anfitriona), sea cual sea su rol: a un
      // admin no le aparecen ni le avisan las reservas de los demás.
      listUserBookings(owner.workspaceId, { status: 'confirmed', from, to, limit: 200, order: 'asc' })
        .then((rows) => rows.filter((b) => attendsBooking(b, owner)))
        .catch(() => []),
      g ? listGoogleEvents(owner.personId, from, to).catch(() => []) : Promise.resolve([]),
      o ? listOutlookEvents(owner.personId, from, to).catch(() => []) : Promise.resolve([]),
    ]);
    // Eventos que Cal creó en Google u Outlook por una reserva: ya están como reserva.
    const copied = new Set<string>();
    for (const b of bookings) {
      const row = b as unknown as { google_event_id?: string | null; outlook_event_id?: string | null };
      if (row.google_event_id) copied.add(eventKey('google', row.google_event_id));
      if (row.outlook_event_id) copied.add(eventKey('outlook', row.outlook_event_id));
    }
    events = [
      ...bookings.map((b) => ({
        key: eventKey('cal', b.id),
        provider: 'cal' as const,
        title: `${b.event_type_title} · ${b.invitee_name}`,
        startsAt: b.starts_at,
        endsAt: b.ends_at,
        attendees: b.invitee_email ? [{ name: b.invitee_name, email: b.invitee_email.toLowerCase() }] : [],
        meetingUrl: b.meeting_url,
        sessionId: null,
      })),
      ...google.map((e) => fromExternal('google', e)).filter((e) => !copied.has(e.key)),
      ...outlook.map((e) => fromExternal('outlook', e)).filter((e) => !copied.has(e.key)),
    ].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    cache.set(key, { at: Date.now(), events });
    if (cache.size > 1000) cache.delete(cache.keys().next().value as string);
  }
  // Reuniones de Voice ya creadas para cada evento (no se cachea: cambia al tomar notas).
  const keys = events.map((e) => e.key);
  const linked = new Map<string, string>();
  if (keys.length) {
    const rows = (await getDb()
      .prepare(
        `SELECT id, event_key, cal_booking_id FROM voice_sessions WHERE workspace_id = ? AND person_id = ? AND kind = 'meeting'
         AND (event_key IN (${keys.map(() => '?').join(',')}) OR cal_booking_id IN (${keys.map(() => '?').join(',')}))
         ORDER BY started_at DESC`,
      )
      .all(owner.workspaceId, owner.personId, ...keys, ...keys.map((k) => k.replace(/^cal:/, '')))) as Array<{
      id: string;
      event_key: string | null;
      cal_booking_id: string | null;
    }>;
    for (const r of rows) {
      const k = r.event_key ?? (r.cal_booking_id ? eventKey('cal', r.cal_booking_id) : null);
      if (k && !linked.has(k)) linked.set(k, r.id);
    }
  }
  return events.map((e) => ({ ...e, sessionId: linked.get(e.key) ?? null }));
}

/** Un evento de la persona por su clave (para empezar la reunión desde el calendario). */
export async function findCalendarEvent(owner: VoiceOwner, key: string): Promise<VoiceCalendarEvent | null> {
  if (!parseEventKey(key)) return null;
  const list = await listCalendarEvents(owner);
  return list.find((e) => e.key === key) ?? (await listCalendarEvents(owner, { fresh: true })).find((e) => e.key === key) ?? null;
}

/** Tras empezar una reunión desde un evento: que la próxima lista lo muestre vinculado. */
export function forgetCalendarCache(owner: VoiceOwner): void {
  const prefix = `${owner.workspaceId}:${owner.personId}:`;
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}
