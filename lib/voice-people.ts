/**
 * Voice: asistentes y evento de la reunión (chip "Hoy · Yo"). Funciones
 * puras, sirven en el cliente y en el servidor.
 */
import type { VoiceAttendee, VoiceCalendarEvent } from './voice-types';

/** Dominios de correo personal: sus asistentes van juntos, no como empresa. */
const PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'gmx.com',
  'hey.com',
]);

export interface AttendeeGroup {
  key: string;
  /** team: gente del workspace; personal: correos personales; company: por dominio. */
  kind: 'team' | 'personal' | 'company';
  label: string;
  people: VoiceAttendee[];
}

/** "acme-corp.co.uk" → "Acme-corp". */
export function companyFromDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter(Boolean);
  if (!parts.length) return domain;
  // El nombre es la parte antes del sufijo (también los de dos partes como .co.uk o .com.ar).
  const twoPart = parts.length >= 3 && parts[parts.length - 2].length <= 3;
  const name = parts[parts.length - (twoPart ? 3 : 2)] ?? parts[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Asistentes agrupados como en Granola: primero el equipo (los que están en el
 * workspace), después cada empresa por su dominio, al final los personales y
 * los que no tienen email.
 */
export function attendeeGroups(attendees: VoiceAttendee[], teamEmails: Set<string>): AttendeeGroup[] {
  const team: VoiceAttendee[] = [];
  const personal: VoiceAttendee[] = [];
  const companies = new Map<string, VoiceAttendee[]>();
  for (const a of attendees) {
    const email = a.email.toLowerCase();
    const domain = email.includes('@') ? email.split('@')[1] : '';
    if (email && teamEmails.has(email)) team.push(a);
    else if (!domain || PERSONAL_DOMAINS.has(domain)) personal.push(a);
    else companies.set(domain, [...(companies.get(domain) ?? []), a]);
  }
  const out: AttendeeGroup[] = [];
  if (team.length) out.push({ key: 'team', kind: 'team', label: '', people: team });
  for (const [domain, people] of [...companies.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    out.push({ key: domain, kind: 'company', label: companyFromDomain(domain), people });
  }
  if (personal.length) out.push({ key: 'personal', kind: 'personal', label: '', people: personal });
  return out;
}

/**
 * El evento que está pasando ahora (o empieza en los próximos 10 minutos),
 * para elegirlo solo en una reunión nueva. Gana el que empieza más cerca de
 * ahora; los que ya tienen reunión de Voice no cuentan.
 */
export function currentCalendarEvent<T extends Pick<VoiceCalendarEvent, 'startsAt' | 'endsAt' | 'sessionId'>>(events: T[], now = new Date()): T | null {
  const t = now.getTime();
  const live = events.filter((e) => !e.sessionId && Date.parse(e.startsAt) - 10 * 60_000 <= t && t < Date.parse(e.endsAt));
  live.sort((a, b) => Math.abs(Date.parse(a.startsAt) - t) - Math.abs(Date.parse(b.startsAt) - t));
  return live[0] ?? null;
}

/** Reunión creada hace menos de 15 minutos: puede tomar sola el evento que está pasando. */
export function isFreshMeeting(startedAt: string, now = new Date()): boolean {
  const age = now.getTime() - Date.parse(startedAt);
  return age >= -60_000 && age < 15 * 60_000;
}

/** El día local de la persona (de 00:00 a 24:00) en ISO, para pedir los eventos de hoy. */
export function localDayWindow(now: Date): { from: string; to: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}
