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
 * el registro de actividad de Cal y las notificaciones. Solo se tocan filas de
 * esa persona (las que tienen su email exacto o están atadas a sus reservas):
 * ahí el email y el nombre (como valor completo) pasan a "[deleted]"; un texto
 * ajeno que contenga su nombre o un email parecido queda intacto. El registro de actividad deja el email enmascarado.
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
       WHERE f.user_id = ? AND EXISTS (SELECT 1 FROM json_each(s.answers) j WHERE lower(trim(j.value)) = ?)`,
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

function escapeRe(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * El email exacto, no como parte de otro (a@example.com no es
 * ana@example.com): ni antes ni después puede haber un carácter de email.
 */
export function emailPattern(email: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9._%+-])${escapeRe(email)}(?![A-Za-z0-9.-])`, 'gi');
}

/**
 * Anonimiza el texto de una fila de esta persona: su email exacto y su nombre
 * solo como valor JSON completo ("name":"Ana" → "[deleted]"), nunca como
 * parte de otro texto (un título que contenga el nombre queda intacto).
 */
export function redactRow(text: string, email: string, names: string[]): string {
  let out = text.replace(emailPattern(email), REDACTED);
  for (const name of names) {
    if (!name) continue;
    const quoted = JSON.stringify(name);
    out = out.replace(new RegExp(escapeRe(quoted), 'gi'), JSON.stringify(REDACTED));
  }
  return out;
}

/**
 * Anonimiza las filas de `table` del workspace (filtro `scope`) donde aparece
 * el email exacto de la persona. Solo esas filas: son de ella. Devuelve cuántas cambió.
 */
async function scrub(
  table: string,
  idCol: string,
  cols: string[],
  scope: { sql: string; args: string[] },
  email: string,
  names: string[],
): Promise<number> {
  const db = getDb();
  const match = cols.map((c) => `lower(COALESCE(${c}, '')) LIKE ?`).join(' OR ');
  const rows = (await db
    .prepare(`SELECT ${idCol} AS rid, ${cols.join(', ')} FROM ${table} WHERE (${scope.sql}) AND (${match})`)
    .all(...scope.args, ...cols.map(() => `%${email}%`))) as Array<Record<string, unknown>>;
  let changed = 0;
  for (const r of rows) {
    // El LIKE es un prefiltro: la fila cuenta solo si tiene el email exacto.
    if (!cols.some((c) => typeof r[c] === 'string' && emailPattern(email).test(r[c] as string))) continue;
    const sets = cols.map((c) => `${c} = ?`).join(', ');
    const values = cols.map((c) => (typeof r[c] === 'string' ? redactRow(r[c] as string, email, names) : r[c]));
    await db.prepare(`UPDATE ${table} SET ${sets} WHERE ${idCol} = ?`).run(...(values as Array<string | null>), r.rid as string);
    changed++;
  }
  return changed;
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
         WHERE f.user_id = ? AND EXISTS (SELECT 1 FROM json_each(s.answers) j WHERE lower(trim(j.value)) = ?))`,
    )
    .run(workspaceId, email);
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
  await scrub('webhook_deliveries', 'id', ['payload', 'response_body', 'last_error'], { sql: 'webhook_id IN (SELECT id FROM webhooks WHERE user_id = ?)', args: [workspaceId] }, email, names);
  await scrub('flow_runs', 'id', ['input', 'context', 'error'], ws, email, names);
  await scrub(
    'flow_steps',
    'id',
    ['input', 'output', 'error'],
    { sql: 'run_id IN (SELECT id FROM flow_runs WHERE user_id = ?)', args: [workspaceId] },
    email,
    names,
  );
  await scrub('flow_jobs', 'id', ['payload'], { sql: 'run_id IN (SELECT id FROM flow_runs WHERE user_id = ?)', args: [workspaceId] }, email, names);
  // El log de apps solo se toca si tiene el email (Cal no guarda ahí el nombre del invitado).
  await scrub('crm_app_log', 'id', ['detail'], ws, email, names);
  if (bookingIds.length > 0) {
    await db
      .prepare(`UPDATE calendar_activity SET summary = ? WHERE user_id = ? AND target_id IN (${bookingIds.map(() => '?').join(', ')})`)
      .run(REDACTED, workspaceId, ...bookingIds);
  }
  // La actividad atada a sus reservas ya quedó en [deleted]; el resto, solo con el email exacto.
  await scrub('calendar_activity', 'id', ['summary'], ws, email, names);
  await scrub('notifications', 'id', ['title', 'body', 'href', 'meta'], people, email, names);

  await logCalActivity(workspaceId, actorId, 'privacy.invitee_deleted', {
    type: 'invitee',
    summary: `${maskEmail(email)} · ${preview.bookings} / ${preview.submissions} / ${preview.votes}`,
  });
  return preview;
}
