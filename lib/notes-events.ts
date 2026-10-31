/**
 * Notes: nota desde un evento. Lista las reservas próximas de Cal de la
 * persona (como anfitriona) y arma una nota con título, fecha, invitados y
 * link a la reserva. No lee los eventos de Google u Outlook: de esos calendarios
 * Cal solo mira si la hora está ocupada. Server-only.
 */
import { getDb } from './db';
import type { DocsBlock } from './docs-types';
import { createNote, type NoteOwner } from './notes';
import type { NoteDetail } from './notes-types';

export interface NoteEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  attendee: string;
}

const HORIZON_DAYS = 14;
const BACK_HOURS = 24;

interface Row {
  id: string;
  title: string | null;
  start_time: string;
  end_time: string;
  guest_name: string | null;
  guest_email: string | null;
}

const SELECT = `SELECT b.id, et.title AS title, b.starts_at AS start_time, b.ends_at AS end_time, b.invitee_name AS guest_name, b.invitee_email AS guest_email
  FROM calendar_bookings b JOIN calendar_event_types et ON et.id = b.event_type_id`;

const toEvent = (r: Row): NoteEvent => ({
  id: r.id,
  title: r.title ?? '',
  start: r.start_time,
  end: r.end_time,
  attendee: r.guest_name || r.guest_email || '',
});

export async function listNoteEvents(owner: NoteOwner, now = new Date()): Promise<NoteEvent[]> {
  const from = new Date(now.getTime() - BACK_HOURS * 3_600_000).toISOString();
  const to = new Date(now.getTime() + HORIZON_DAYS * 86_400_000).toISOString();
  const rows = (await getDb()
    .prepare(
      `${SELECT} WHERE et.user_id = ? AND COALESCE(b.host_user_id, et.user_id) = ? AND b.status = 'confirmed' AND b.starts_at >= ? AND b.starts_at <= ?
       ORDER BY b.starts_at LIMIT 30`,
    )
    .all(owner.workspaceId, owner.personId, from, to)) as Row[];
  return rows.map(toEvent);
}

export function eventNoteBlocks(ev: NoteEvent, labels: { when: string; with: string; agenda: string; notes: string; actions: string }, whenText: string): DocsBlock[] {
  const id = () => crypto.randomUUID();
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    { id: id(), type: 'paragraph', content: `<strong>${esc(labels.when)}:</strong> ${esc(whenText)}` },
    ...(ev.attendee ? [{ id: id(), type: 'paragraph' as const, content: `<strong>${esc(labels.with)}:</strong> ${esc(ev.attendee)}` }] : []),
    { id: id(), type: 'heading', level: 2, content: esc(labels.agenda) },
    { id: id(), type: 'bulleted_list_item', content: '' },
    { id: id(), type: 'heading', level: 2, content: esc(labels.notes) },
    { id: id(), type: 'paragraph', content: '' },
    { id: id(), type: 'heading', level: 2, content: esc(labels.actions) },
    { id: id(), type: 'todo', content: '', checked: false },
  ];
}

export async function noteFromEvent(
  owner: NoteOwner,
  eventId: string,
  labels: { when: string; with: string; agenda: string; notes: string; actions: string },
  locale: string,
  timezone: string,
): Promise<NoteDetail | null> {
  const row = (await getDb()
    .prepare(`${SELECT} WHERE b.id = ? AND et.user_id = ? AND COALESCE(b.host_user_id, et.user_id) = ?`)
    .get(eventId, owner.workspaceId, owner.personId)) as Row | undefined;
  if (!row) return null;
  const ev = toEvent(row);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone: timezone }).format(new Date(ev.start));
  return createNote(owner, {
    title: ev.attendee ? `${ev.title}: ${ev.attendee}` : ev.title,
    content: eventNoteBlocks(ev, labels, when),
    tags: ['meeting'],
  });
}
