/**
 * Cal — borrado de los datos de un invitado (GDPR / LGPD), como "Delete
 * invitee data" de Calendly: por email, en todo el workspace.
 *
 * Borra sus reservas (pasadas y por venir: las por venir se sacan antes del
 * calendario del anfitrión y se borra la reunión de Zoom, sin avisos) con sus
 * recordatorios y pasos de workflow en cola, sus envíos de routing forms y sus
 * votos en encuestas, y saca su email de la lista de invitados extra de otras
 * reservas. Después anonimiza las copias que quedaron en los registros del
 * workspace: entregas de webhooks, corridas de Flow, el log de apps del CRM,
 * el registro de actividad de Cal y las notificaciones (el email y el nombre
 * pasan a "[deleted]"). El registro de actividad deja el email enmascarado.
 * El contacto del CRM es otra app: se borra desde el CRM. Server-only.
 */
import { getDb, type CalendarBookingRow } from './db';
import { getEventTypeById } from './calendar';
import { deleteExternalForBooking } from './calendar-external';
import { logCalActivity, maskEmail } from './calendar-activity';

export const REDACTED = '[deleted]';

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
       WHERE f.user_id = ? AND lower(s.answers) LIKE ?`,
    )
    .get(workspaceId, `%${email}%`)) as { n: number };
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

/** `text` con cada término reemplazado por [deleted] (sin distinguir mayúsculas). */
export function redactTerms(text: string, terms: string[]): string {
  let out = text;
  for (const term of terms) {
    if (!term) continue;
    out = out.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), REDACTED);
  }
  return out;
}

/**
 * Anonimiza las filas de `table` del workspace (filtro `scope`) cuyas columnas
 * contienen el email (o el nombre, si `byName`). Devuelve cuántas cambió.
 */
async function scrub(
  table: string,
  idCol: string,
  cols: string[],
  scope: { sql: string; args: string[] },
  email: string,
  names: string[],
  byName: boolean,
): Promise<number> {
  const db = getDb();
  const likes = [email, ...(byName ? names : [])].filter(Boolean);
  if (likes.length === 0) return 0;
  const match = cols.map((c) => likes.map(() => `lower(COALESCE(${c}, '')) LIKE ?`).join(' OR ')).join(' OR ');
  const rows = (await db
    .prepare(`SELECT ${idCol} AS rid, ${cols.join(', ')} FROM ${table} WHERE (${scope.sql}) AND (${match})`)
    .all(...scope.args, ...cols.flatMap(() => likes.map((l) => `%${l.toLowerCase()}%`)))) as Array<Record<string, unknown>>;
  for (const r of rows) {
    const sets = cols.map((c) => `${c} = ?`).join(', ');
    // En las filas que tienen el email también se borra el nombre (son de esta persona).
    const values = cols.map((c) => (typeof r[c] === 'string' ? redactTerms(r[c] as string, [email, ...names]) : r[c]));
    await db.prepare(`UPDATE ${table} SET ${sets} WHERE ${idCol} = ?`).run(...(values as Array<string | null>), r.rid as string);
  }
  return rows.length;
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
  // Nombres con los que aparece (reservas y votos): también se anonimizan.
  const voterNames = (await db
    .prepare(
      `SELECT DISTINCT v.voter_name AS name FROM calendar_poll_votes v JOIN calendar_polls p ON p.id = v.poll_id
       WHERE p.user_id = ? AND lower(v.voter_email) = ?`,
    )
    .all(workspaceId, email)) as Array<{ name: string }>;
  const names = [...new Set([...rows.map((b) => b.invitee_name), ...voterNames.map((v) => v.name)].map((n) => n.trim()).filter((n) => n.length >= 3))];
  const bookingIds = rows.map((b) => b.id);

  for (const b of rows) {
    // Las que siguen en pie salen del calendario del anfitrión (sin avisos).
    if (b.ends_at > nowIso && (b.status === 'confirmed' || b.status === 'pending')) {
      const et = await getEventTypeById(b.event_type_id);
      if (et) await deleteExternalForBooking(b, et).catch(() => null);
    }
    await db.prepare('DELETE FROM calendar_workflow_runs WHERE booking_id = ?').run(b.id);
    await db.prepare('DELETE FROM calendar_reminders WHERE booking_id = ?').run(b.id);
    await db.prepare('DELETE FROM calendar_sms_sends WHERE booking_id = ?').run(b.id);
    await db.prepare('UPDATE calendar_polls SET booking_id = NULL WHERE booking_id = ?').run(b.id);
    await db.prepare('DELETE FROM calendar_bookings WHERE id = ?').run(b.id);
  }
  // Invitado extra en reservas de otros: se saca de la lista (y de las zonas de los invitados).
  const asGuest = (await db
    .prepare(
      `SELECT b.id, b.guests, b.guest_timezones FROM calendar_bookings b JOIN calendar_event_types e ON e.id = b.event_type_id
       WHERE e.user_id = ? AND EXISTS (SELECT 1 FROM json_each(b.guests) j WHERE lower(j.value) = ?)`,
    )
    .all(workspaceId, email)) as Array<{ id: string; guests: string; guest_timezones: string }>;
  for (const r of asGuest) {
    let list: string[] = [];
    let tzs: Record<string, string> = {};
    try {
      list = (JSON.parse(r.guests || '[]') as unknown[]).filter((g): g is string => typeof g === 'string');
      tzs = JSON.parse(r.guest_timezones || '{}') as Record<string, string>;
    } catch {
      list = [];
    }
    for (const k of Object.keys(tzs)) if (norm(k) === email) delete tzs[k];
    await db
      .prepare('UPDATE calendar_bookings SET guests = ?, guest_timezones = ? WHERE id = ?')
      .run(JSON.stringify(list.filter((g) => norm(g) !== email)), JSON.stringify(tzs), r.id);
  }
  await db
    .prepare(
      `DELETE FROM calendar_routing_submissions WHERE id IN (
         SELECT s.id FROM calendar_routing_submissions s JOIN calendar_routing_forms f ON f.id = s.form_id
         WHERE f.user_id = ? AND lower(s.answers) LIKE ?)`,
    )
    .run(workspaceId, `%${email}%`);
  await db
    .prepare(
      `DELETE FROM calendar_poll_votes WHERE id IN (
         SELECT v.id FROM calendar_poll_votes v JOIN calendar_polls p ON p.id = v.poll_id
         WHERE p.user_id = ? AND lower(v.voter_email) = ?)`,
    )
    .run(workspaceId, email);

  // Copias en los registros del workspace.
  const ws = { sql: 'user_id = ?', args: [workspaceId] };
  const people = {
    sql: `user_id = ? OR user_id IN (SELECT m.user_id FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ?)`,
    args: [workspaceId, workspaceId],
  };
  await scrub('webhook_deliveries', 'id', ['payload', 'response_body', 'last_error'], { sql: 'webhook_id IN (SELECT id FROM webhooks WHERE user_id = ?)', args: [workspaceId] }, email, names, false);
  await scrub('flow_runs', 'id', ['input', 'context', 'error'], ws, email, names, false);
  await scrub(
    'flow_steps',
    'id',
    ['input', 'output', 'error'],
    { sql: 'run_id IN (SELECT id FROM flow_runs WHERE user_id = ?)', args: [workspaceId] },
    email,
    names,
    false,
  );
  await scrub('flow_jobs', 'id', ['payload'], { sql: 'run_id IN (SELECT id FROM flow_runs WHERE user_id = ?)', args: [workspaceId] }, email, names, false);
  // El log de apps (Zoom) y la actividad de Cal guardan el nombre sin el email.
  await scrub('crm_app_log', 'id', ['detail'], ws, email, names, true);
  if (bookingIds.length > 0) {
    await db
      .prepare(`UPDATE calendar_activity SET summary = ? WHERE user_id = ? AND target_id IN (${bookingIds.map(() => '?').join(', ')})`)
      .run(REDACTED, workspaceId, ...bookingIds);
  }
  await scrub('calendar_activity', 'id', ['summary'], ws, email, names, true);
  await scrub('notifications', 'id', ['title', 'body', 'href', 'meta'], people, email, names, false);

  await logCalActivity(workspaceId, actorId, 'privacy.invitee_deleted', {
    type: 'invitee',
    summary: `${maskEmail(email)} · ${preview.bookings} / ${preview.submissions} / ${preview.votes}`,
  });
  return preview;
}
