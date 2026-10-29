/**
 * Detección de reuniones (pura): por calendario (eventos de Voice) y por la
 * app de videollamada en uso (procesos y títulos de ventanas).
 */

export type MeetingApp = 'zoom' | 'meet' | 'teams';

export interface CalendarEventLite {
  key: string;
  title: string;
  startsAt: string;
  endsAt: string;
  sessionId: string | null;
}

/**
 * La app de reunión en curso, o null. Señales:
 * - Zoom: el proceso CptHost existe solo durante una llamada (Mac y Windows),
 *   o una ventana "Zoom Meeting" / "Zoom Webinar".
 * - Meet: una ventana del navegador con "Meet - abc-defg-hij" o meet.google.com.
 * - Teams: una ventana de reunión o llamada de Microsoft Teams.
 */
export function detectMeetingApp(input: { processes: readonly string[]; windowTitles: readonly string[] }): MeetingApp | null {
  const procs = input.processes.map((p) => p.trim().toLowerCase().replace(/\.exe$/, ''));
  const titles = input.windowTitles.map((t) => t.trim()).filter(Boolean);
  if (procs.includes('cpthost') || titles.some((t) => /^zoom (meeting|webinar)\b/i.test(t))) return 'zoom';
  if (titles.some((t) => /(^|\s)meet\s*[-–—:]\s*[a-z]{3}-[a-z]{4}-[a-z]{3}\b/i.test(t) || /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(t))) return 'meet';
  if (titles.some((t) => /microsoft teams/i.test(t) && /\b(meeting|call|reuni[oóã]n?|reunião|llamada|chamada)\b/i.test(t))) return 'teams';
  return null;
}

/** Ventana del aviso: desde 2 min antes del inicio hasta 10 min después. */
export const EVENT_LEAD_MS = 2 * 60_000;
export const EVENT_GRACE_MS = 10 * 60_000;

/** Eventos para avisar ahora: en la ventana, sin reunión de Voice todavía y sin aviso previo. */
export function dueEvents<T extends CalendarEventLite>(events: readonly T[], now: number, notified: ReadonlySet<string>): T[] {
  return events.filter((e) => {
    if (e.sessionId || notified.has(e.key)) return false;
    const start = Date.parse(e.startsAt);
    const end = Date.parse(e.endsAt);
    if (!Number.isFinite(start)) return false;
    if (Number.isFinite(end) && now > end) return false;
    return now >= start - EVENT_LEAD_MS && now <= start + EVENT_GRACE_MS;
  });
}

/** Evento de calendario en curso (para ponerle su título a una reunión detectada por app). */
export function currentEvent<T extends CalendarEventLite>(events: readonly T[], now: number): T | null {
  return (
    events.find((e) => {
      const start = Date.parse(e.startsAt);
      const end = Date.parse(e.endsAt);
      return Number.isFinite(start) && Number.isFinite(end) && now >= start - EVENT_LEAD_MS && now <= end;
    }) ?? null
  );
}
