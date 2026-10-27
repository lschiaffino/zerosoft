/**
 * Cal — borrado de los datos de un invitado (GDPR / LGPD), como "Delete
 * invitee data" de Calendly: por email, en todo el workspace.
 *
 * Borra sus reservas (pasadas y por venir: las por venir se sacan antes del
 * calendario del anfitrión y se borra la reunión de Zoom, sin avisos), sus
 * envíos de routing forms, sus votos en encuestas de horario y su email de la
 * lista de invitados extra de otras reservas. El registro de actividad deja
 * el email enmascarado. El contacto del CRM es otra app: se borra desde el
 * CRM. Server-only.
 */
import { getDb, type CalendarBookingRow } from './db';
import { getEventTypeById } from './calendar';
import { deleteExternalForBooking } from './calendar-external';
import { logCalActivity, maskEmail } from './calendar-activity';

export interface InviteeDataPreview {
  bookings: number;
  upcoming: number;
  submissions: number;
  votes: number;
  guestOf: number;
}

function norm(email: string): string {
  return email.trim().toLowerCase();
}

/** Lo que se borraría (para confirmar antes). */
export async function previewInviteeData(workspaceId: string, rawEmail: string): Promise<InviteeDataPreview> {
  const email = norm(rawEmail);
  const db = getDb();
  const nowIso = new Date().toISOString();
  const b = (await db
    .prepare(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN b.ends_at > ? AND b.status IN ('confirmed', 'pending') THEN 1 ELSE 0 END) AS up
       FROM calendar_bookings b JOIN calendar_event_types e ON e.id = b.event_type_id
       WHERE e.user_id = ? AND lower(b.invitee_email) = ?`,
    )
    .get(nowIso, workspaceId, email)) as { n: number; up: number | null };
  const guestOf = (await db
    .prepare(
      `SELECT COUNT(*) AS n FROM calendar_bookings b JOIN calendar_event_types e ON e.id = b.event_type_id
       WHERE e.user_id = ? AND lower(b.invitee_email) != ? AND EXISTS (SELECT 1 FROM json_each(b.guests) j WHERE lower(j.value) = ?)`,
    )
    .get(workspaceId, email, email)) as { n: number };
  const submissions = (await db
    .prepare(
      `SELECT COUNT(*) AS n FROM calendar_routing_submissions s JOIN calendar_routing_forms f ON f.id = s.form_id
       WHERE f.user_id = ? AND EXISTS (SELECT 1 FROM json_each(s.answers) j WHERE lower(j.value) = ?)`,
    )
    .get(workspaceId, email)) as { n: number };
  const votes = (await db
    .prepare(
      `SELECT COUNT(*) AS n FROM calendar_poll_votes v JOIN calendar_polls p ON p.id = v.poll_id
       WHERE p.user_id = ? AND lower(v.voter_email) = ?`,
    )
    .get(workspaceId, email)) as { n: number };
  return {
    bookings: Number(b.n ?? 0),
    upcoming: Number(b.up ?? 0),
    submissions: Number(submissions.n ?? 0),
    votes: Number(votes.n ?? 0),
    guestOf: Number(guestOf.n ?? 0),
  };
}

/** Borra todo lo del invitado en el workspace. Devuelve lo que había. */
export async function deleteInviteeData(workspaceId: string, rawEmail: string, actorId: string): Promise<InviteeDataPreview> {
  const email = norm(rawEmail);
  const db = getDb();
  const preview = await previewInviteeData(workspaceId, email);
  const nowIso = new Date().toISOString();
  const rows = (await db
    .prepare(
      `SELECT b.* FROM calendar_bookings b JOIN calendar_event_types e ON e.id = b.event_type_id
       WHERE e.user_id = ? AND lower(b.invitee_email) = ?`,
    )
    .all(workspaceId, email)) as CalendarBookingRow[];
  for (const b of rows) {
    // Las que siguen en pie salen del calendario del anfitrión (sin avisos).
    if (b.ends_at > nowIso && (b.status === 'confirmed' || b.status === 'pending')) {
      const et = await getEventTypeById(b.event_type_id);
      if (et) await deleteExternalForBooking(b, et).catch(() => null);
    }
    await db.prepare('DELETE FROM calendar_workflow_runs WHERE booking_id = ?').run(b.id);
    await db.prepare('DELETE FROM calendar_reminders WHERE booking_id = ?').run(b.id);
    await db.prepare('DELETE FROM calendar_bookings WHERE id = ?').run(b.id);
  }
  // Invitado extra en reservas de otros: se saca de la lista.
  const asGuest = (await db
    .prepare(
      `SELECT b.id, b.guests FROM calendar_bookings b JOIN calendar_event_types e ON e.id = b.event_type_id
       WHERE e.user_id = ? AND EXISTS (SELECT 1 FROM json_each(b.guests) j WHERE lower(j.value) = ?)`,
    )
    .all(workspaceId, email)) as Array<{ id: string; guests: string }>;
  for (const r of asGuest) {
    let list: string[] = [];
    try {
      list = (JSON.parse(r.guests || '[]') as unknown[]).filter((g): g is string => typeof g === 'string');
    } catch {
      list = [];
    }
    await db.prepare('UPDATE calendar_bookings SET guests = ? WHERE id = ?').run(JSON.stringify(list.filter((g) => norm(g) !== email)), r.id);
  }
  await db
    .prepare(
      `DELETE FROM calendar_routing_submissions WHERE id IN (
         SELECT s.id FROM calendar_routing_submissions s JOIN calendar_routing_forms f ON f.id = s.form_id
         WHERE f.user_id = ? AND EXISTS (SELECT 1 FROM json_each(s.answers) j WHERE lower(j.value) = ?))`,
    )
    .run(workspaceId, email);
  await db
    .prepare(
      `DELETE FROM calendar_poll_votes WHERE id IN (
         SELECT v.id FROM calendar_poll_votes v JOIN calendar_polls p ON p.id = v.poll_id
         WHERE p.user_id = ? AND lower(v.voter_email) = ?)`,
    )
    .run(workspaceId, email);
  await logCalActivity(workspaceId, actorId, 'privacy.invitee_deleted', {
    type: 'invitee',
    summary: `${maskEmail(email)} · ${preview.bookings} / ${preview.submissions} / ${preview.votes}`,
  });
  return preview;
}
