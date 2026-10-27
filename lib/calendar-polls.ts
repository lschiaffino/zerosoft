/**
 * Cal — encuestas de horario (Meeting polls de Calendly): quien organiza
 * propone de 2 a 20 horarios, comparte un link y cada participante marca los
 * que le sirven (sin cuenta, con nombre y email; puede cambiar su voto). El
 * organizador ve la grilla, elige el horario y reserva: se crea la reunión con
 * todos los participantes (el primero que votó ese horario es el invitado
 * principal y el resto, invitados extra), con emails, .ics, calendario y CRM
 * como cualquier reserva.
 *
 * Por debajo, reservar crea un tipo de evento oculto (kind 'poll', link de un
 * solo uso con ese horario) para reutilizar todo el motor de reservas. Ese
 * tipo no sale en la lista ni en el perfil. Server-only.
 */
import { randomBytes } from 'crypto';
import { getDb, type CalendarBookingRow } from './db';
import { CalendarError, createBooking, createEventType, getOrCreateCalendarUser } from './calendar';
import { MAX_GUESTS } from './calendar-questions';

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 20;
export const POLL_MAX_VOTES = 200;

export interface PollRow {
  id: string;
  user_id: string;
  created_by: string | null;
  title: string;
  description: string;
  duration_min: number;
  location: string;
  token: string;
  status: 'open' | 'booked' | 'closed';
  event_type_id: string | null;
  booking_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PollOption {
  id: string;
  startsAt: string;
}

export interface PollVote {
  id: string;
  name: string;
  email: string;
  optionIds: string[];
  createdAt: string;
}

export interface PollDetail extends PollRow {
  options: PollOption[];
  votes: PollVote[];
}

export interface PollListItem extends PollRow {
  optionCount: number;
  voteCount: number;
}

function now(): string {
  return new Date().toISOString();
}

function parseIds(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Horarios válidos: futuros, sin repetir, ordenados. */
export function cleanPollTimes(times: string[], at = new Date()): string[] {
  const out = new Set<string>();
  for (const raw of times) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime()) || d.getTime() <= at.getTime()) continue;
    d.setUTCSeconds(0, 0);
    out.add(d.toISOString());
  }
  return [...out].sort();
}

/** Cuántos votos tiene cada horario (para la grilla y para elegir el mejor). */
export function tallyVotes(options: PollOption[], votes: PollVote[]): Map<string, number> {
  const tally = new Map(options.map((o) => [o.id, 0]));
  for (const v of votes) for (const id of v.optionIds) if (tally.has(id)) tally.set(id, (tally.get(id) ?? 0) + 1);
  return tally;
}

export async function listPolls(workspaceId: string): Promise<PollListItem[]> {
  return (await getDb()
    .prepare(
      `SELECT p.*,
         (SELECT COUNT(*) FROM calendar_poll_options o WHERE o.poll_id = p.id) AS optionCount,
         (SELECT COUNT(*) FROM calendar_poll_votes v WHERE v.poll_id = p.id) AS voteCount
       FROM calendar_polls p WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 200`,
    )
    .all(workspaceId)) as PollListItem[];
}

async function detail(row: PollRow | undefined): Promise<PollDetail | null> {
  if (!row) return null;
  const options = (await getDb()
    .prepare('SELECT id, starts_at FROM calendar_poll_options WHERE poll_id = ? ORDER BY position, starts_at')
    .all(row.id)) as Array<{ id: string; starts_at: string }>;
  const votes = (await getDb()
    .prepare('SELECT id, voter_name, voter_email, option_ids, created_at FROM calendar_poll_votes WHERE poll_id = ? ORDER BY created_at')
    .all(row.id)) as Array<{ id: string; voter_name: string; voter_email: string; option_ids: string; created_at: string }>;
  return {
    ...row,
    options: options.map((o) => ({ id: o.id, startsAt: o.starts_at })),
    votes: votes.map((v) => ({ id: v.id, name: v.voter_name, email: v.voter_email, optionIds: parseIds(v.option_ids), createdAt: v.created_at })),
  };
}

export async function getPoll(workspaceId: string, id: string): Promise<PollDetail | null> {
  return detail((await getDb().prepare('SELECT * FROM calendar_polls WHERE id = ? AND user_id = ?').get(id, workspaceId)) as PollRow | undefined);
}

export async function getPollByToken(token: string): Promise<PollDetail | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  return detail((await getDb().prepare('SELECT * FROM calendar_polls WHERE token = ?').get(token)) as PollRow | undefined);
}

export async function createPoll(
  workspaceId: string,
  actorId: string,
  input: { title: string; description?: string; durationMin: number; location?: string; times: string[] },
): Promise<PollDetail> {
  const times = cleanPollTimes(input.times);
  if (times.length < POLL_MIN_OPTIONS || times.length > POLL_MAX_OPTIONS) throw new CalendarError('poll_times', 400);
  const id = crypto.randomUUID();
  const ts = now();
  const db = getDb();
  await db
    .prepare(
      `INSERT INTO calendar_polls (id, user_id, created_by, title, description, duration_min, location, token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, actorId, input.title, input.description ?? '', input.durationMin, input.location ?? '', randomBytes(18).toString('base64url'), ts, ts);
  const ins = db.prepare('INSERT INTO calendar_poll_options (id, poll_id, starts_at, position) VALUES (?, ?, ?, ?)');
  for (let i = 0; i < times.length; i++) await ins.run(crypto.randomUUID(), id, times[i], i);
  return (await getPoll(workspaceId, id)) as PollDetail;
}

/** Renombrar, cambiar la descripción o cerrar / reabrir (una reservada no cambia de estado). */
export async function updatePoll(
  workspaceId: string,
  id: string,
  patch: { title?: string; description?: string; location?: string; status?: 'open' | 'closed' },
): Promise<PollDetail | null> {
  const poll = await getPoll(workspaceId, id);
  if (!poll) return null;
  const sets: string[] = [];
  const values: string[] = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    values.push(patch.title);
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    values.push(patch.description);
  }
  if (patch.location !== undefined) {
    sets.push('location = ?');
    values.push(patch.location);
  }
  if (patch.status !== undefined && poll.status !== 'booked') {
    sets.push('status = ?');
    values.push(patch.status);
  }
  if (sets.length === 0) return poll;
  sets.push('updated_at = ?');
  values.push(now());
  await getDb()
    .prepare(`UPDATE calendar_polls SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .run(...values, id, workspaceId);
  return getPoll(workspaceId, id);
}

export async function deletePoll(workspaceId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM calendar_polls WHERE id = ? AND user_id = ?').run(id, workspaceId);
  return res.changes > 0;
}

/** Voto (o cambio de voto) de un participante: los horarios que le sirven. */
export async function votePoll(
  token: string,
  input: { name: string; email: string; optionIds: string[] },
): Promise<PollDetail> {
  const poll = await getPollByToken(token);
  if (!poll) throw new CalendarError('not_found', 404);
  if (poll.status !== 'open') throw new CalendarError('poll_closed', 409);
  const valid = new Set(poll.options.map((o) => o.id));
  const chosen = [...new Set(input.optionIds)].filter((id) => valid.has(id));
  if (chosen.length === 0) throw new CalendarError('invalid_input', 400);
  const email = input.email.trim().toLowerCase();
  const existing = poll.votes.find((v) => v.email.toLowerCase() === email);
  if (!existing && poll.votes.length >= POLL_MAX_VOTES) throw new CalendarError('poll_full', 409);
  const ts = now();
  if (existing) {
    await getDb()
      .prepare('UPDATE calendar_poll_votes SET voter_name = ?, option_ids = ?, updated_at = ? WHERE id = ?')
      .run(input.name.trim(), JSON.stringify(chosen), ts, existing.id);
  } else {
    await getDb()
      .prepare(
        `INSERT INTO calendar_poll_votes (id, poll_id, voter_name, voter_email, option_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), poll.id, input.name.trim(), email, JSON.stringify(chosen), ts, ts);
  }
  return (await getPollByToken(token)) as PollDetail;
}

/**
 * Reserva el horario elegido con todos los participantes. Atómico sobre el
 * estado: si otra pestaña ya la reservó, 'poll_closed'. Si el horario se
 * ocupó en la agenda del organizador, 'slot_unavailable' y la encuesta sigue
 * abierta.
 */
export async function bookPoll(
  workspaceId: string,
  id: string,
  optionId: string,
  locale = 'en',
): Promise<{ poll: PollDetail; booking: CalendarBookingRow }> {
  const poll = await getPoll(workspaceId, id);
  if (!poll) throw new CalendarError('not_found', 404);
  if (poll.status !== 'open') throw new CalendarError('poll_closed', 409);
  const option = poll.options.find((o) => o.id === optionId);
  if (!option) throw new CalendarError('invalid_input', 400);
  if (new Date(option.startsAt).getTime() <= Date.now()) throw new CalendarError('already_started', 409);
  // Primero los que votaron ese horario, después el resto: todos quedan invitados.
  const ordered = [...poll.votes.filter((v) => v.optionIds.includes(optionId)), ...poll.votes.filter((v) => !v.optionIds.includes(optionId))];
  if (ordered.length === 0) throw new CalendarError('poll_no_votes', 409);
  const [main, ...rest] = ordered;
  const claimed = await getDb()
    .prepare("UPDATE calendar_polls SET status = 'booked', updated_at = ? WHERE id = ? AND status = 'open'")
    .run(now(), id);
  if (claimed.changes === 0) throw new CalendarError('poll_closed', 409);
  let createdEventTypeId: string | null = null;
  try {
    await getOrCreateCalendarUser(workspaceId);
    const host = poll.created_by && poll.created_by !== workspaceId ? poll.created_by : null;
    const eventType = await createEventType(
      workspaceId,
      {
        slug: `poll-${poll.id.slice(0, 8)}-${Date.now().toString(36)}`,
        title: poll.title,
        durationMin: poll.duration_min,
        location: poll.location,
        description: poll.description,
        active: true,
        hidden: true,
        oneOffTimes: [option.startsAt],
        bookingRules: { allowGuests: true, maxGuests: MAX_GUESTS },
        ...(host ? { hostIds: [host] } : {}),
      },
      { kind: 'poll' },
    );
    createdEventTypeId = eventType.id;
    const booking = await createBooking(
      {
        eventTypeId: eventType.id,
        email: main.email,
        name: main.name,
        start: option.startsAt,
        timezone: 'UTC',
        answers: {},
        guests: rest.map((v) => v.email).slice(0, MAX_GUESTS),
        locale: locale === 'es' || locale === 'pt' ? locale : 'en',
      },
      { bookedBy: poll.created_by, skipApproval: true },
    );
    await getDb()
      .prepare('UPDATE calendar_polls SET event_type_id = ?, booking_id = ?, updated_at = ? WHERE id = ?')
      .run(eventType.id, booking.id, now(), id);
    return { poll: (await getPoll(workspaceId, id)) as PollDetail, booking };
  } catch (err) {
    // No se pudo reservar (horario ocupado): la encuesta vuelve a estar abierta y el tipo oculto se borra.
    if (createdEventTypeId) await getDb().prepare('DELETE FROM calendar_event_types WHERE id = ?').run(createdEventTypeId);
    await getDb().prepare("UPDATE calendar_polls SET status = 'open', updated_at = ? WHERE id = ? AND booking_id IS NULL").run(now(), id);
    throw err;
  }
}
