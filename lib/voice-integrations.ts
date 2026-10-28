/**
 * Voice → el resto de la suite. Server-only.
 * - Markdown de una reunión (copiar, Docs, Notes).
 * - Mandar la nota a Docs (página nueva) o a Notes (nota nueva).
 * - Próximos pasos → issues de Track o tareas del CRM.
 * - Actividad "reunión" en el timeline del contacto del CRM.
 * - Reservas de Cal para vincular una reunión (y su contacto por el email).
 */
import { createDocPage } from './docs';
import { markdownToBlocks } from './docs-import';
import { sanitizeDocsHtml } from './docs-sanitize';
import { createNote } from './notes';
import { canAccessTrackProject, createIssue, getProject } from './track-data';
import { createActivity, updateActivity } from './crm';
import { canSeeEntity, type OwnerScope } from './crm-visibility';
import { findContactByEmail } from './crm-integrations';
import { listUserBookings } from './calendar';
import { getDb } from './db';
import { transcriptAsText, updateSession, VoiceError, type VoiceOwner } from './voice';
import { createTeamspace, TeamspaceLimitError } from './docs-access';
import type { VoiceSessionDetail } from './voice-types';
import { attendsBooking } from './voice-calendar';

export interface MeetingLabels {
  me: string;
  them: string;
  speaker: string;
  summary: string;
  decisions: string;
  actionItems: string;
  myNotes: string;
  transcript: string;
  fromVoice: string;
  /** Nombre del teamspace privado de Docs donde van las notas de Voice. */
  privateSpace: string;
}

/** Nota de la reunión en Markdown. Sin nota mejorada, van las notas propias. */
export function meetingMarkdown(d: VoiceSessionDetail, labels: MeetingLabels, opts: { transcript?: boolean; title?: boolean } = {}): string {
  const out: string[] = [];
  if (opts.title !== false) out.push(`# ${d.title || labels.fromVoice}`, '');
  const e = d.enhanced;
  if (e) {
    if (e.summary) out.push(`## ${labels.summary}`, '', e.summary, '');
    for (const s of e.sections) {
      if (!s.points.length) continue;
      out.push(`## ${s.heading}`, '', ...s.points.map((p) => `- ${p.text}`), '');
    }
    if (e.decisions.length) out.push(`## ${labels.decisions}`, '', ...e.decisions.map((x) => `- ${x}`), '');
    if (e.actionItems.length) {
      out.push(
        `## ${labels.actionItems}`,
        '',
        ...e.actionItems.map((a) => `- [ ] ${a.text}${a.owner ? ` (${a.owner}${a.due ? `, ${a.due}` : ''})` : a.due ? ` (${a.due})` : ''}`),
        '',
      );
    }
  } else if (d.myNotes.trim()) {
    out.push(`## ${labels.myNotes}`, '', d.myNotes.trim(), '');
  }
  if (opts.transcript && d.segments.length) {
    out.push(`## ${labels.transcript}`, '', transcriptAsText(d.segments, d.speakers, labels, { max: 60_000 }).replace(/\n/g, '\n\n'), '');
  }
  return out.join('\n').trim() + '\n';
}

/**
 * Nota en texto plano para el timeline del CRM (que muestra el cuerpo tal cual):
 * títulos en su línea, viñetas con •, sin sintaxis Markdown.
 */
export function meetingPlainText(d: VoiceSessionDetail, labels: MeetingLabels): string {
  const out: string[] = [];
  const e = d.enhanced;
  const block = (title: string, lines: string[]) => {
    if (lines.length) out.push(`${title}\n${lines.join('\n')}`);
  };
  if (e) {
    if (e.summary) block(labels.summary, [e.summary]);
    for (const s of e.sections) block(s.heading, s.points.map((p) => `• ${p.text}`));
    block(labels.decisions, e.decisions.map((x) => `• ${x}`));
    block(
      labels.actionItems,
      e.actionItems.map((a) => `• ${a.text}${a.owner || a.due ? ` (${[a.owner, a.due].filter(Boolean).join(', ')})` : ''}`),
    );
  } else if (d.myNotes.trim()) {
    block(labels.myNotes, [d.myNotes.trim()]);
  }
  return out.join('\n\n');
}

const PRIVATE_SPACE_NAMES = ['Voice meetings', 'Reuniones de Voice', 'Reuniões do Voice'];

/**
 * Teamspace privado de la persona para las notas de Voice (Docs D3): solo ella
 * es miembro, así que ni los admins ven sus páginas hasta que las comparta.
 * Se reusa si ya existe; null si no se puede crear (tope de teamspaces).
 */
export async function ensurePrivateTeamspace(owner: VoiceOwner, name: string): Promise<string | null> {
  const names = [...new Set([name, ...PRIVATE_SPACE_NAMES])];
  const row = (await getDb()
    .prepare(
      `SELECT t.id FROM docs_teamspaces t JOIN docs_teamspace_members m ON m.teamspace_id = t.id AND m.user_id = ?
       WHERE t.workspace_id = ? AND t.access = 'private' AND t.created_by = ? AND t.deleted_at IS NULL
         AND t.name IN (${names.map(() => '?').join(',')})
       ORDER BY t.created_at LIMIT 1`,
    )
    .get(owner.personId, owner.workspaceId, owner.personId, ...names)) as { id: string } | undefined;
  if (row) return row.id;
  try {
    const ts = await createTeamspace(owner.workspaceId, owner.personId, { name, access: 'private', icon: '🎙' });
    return ts.id;
  } catch (err) {
    if (err instanceof TeamspaceLimitError) return null;
    throw err;
  }
}

/**
 * Página nueva en Docs, en el teamspace privado de la persona. Si no se puede
 * crear (tope de teamspaces), solo con `allowWorkspace` va a la raíz, donde
 * la ve todo el workspace (la UI lo confirma). La transcripción va solo si se
 * incluye.
 */
export async function sendToDocs(
  owner: VoiceOwner,
  d: VoiceSessionDetail,
  labels: MeetingLabels,
  opts: { includeTranscript?: boolean; allowWorkspace?: boolean } = {},
): Promise<{ id: string; teamspaceId: string | null }> {
  const teamspaceId = await ensurePrivateTeamspace(owner, labels.privateSpace);
  if (!teamspaceId && !opts.allowWorkspace) throw new VoiceError('docs_private_unavailable');
  const md = meetingMarkdown(d, labels, { transcript: opts.includeTranscript === true, title: false });
  const page = await createDocPage(owner.workspaceId, {
    title: d.title || labels.fromVoice,
    content: markdownToBlocks(md, { sanitize: sanitizeDocsHtml }),
    teamspace_id: teamspaceId,
  });
  await updateSession(owner, d.id, { docsPageId: page.id });
  return { id: page.id, teamspaceId };
}

export async function sendToNotes(owner: VoiceOwner, d: VoiceSessionDetail, labels: MeetingLabels): Promise<{ id: string }> {
  const md = meetingMarkdown(d, labels, { transcript: false, title: false });
  const note = await createNote(owner, {
    title: d.title || labels.fromVoice,
    content: markdownToBlocks(md, { sanitize: sanitizeDocsHtml }),
  });
  await updateSession(owner, d.id, { noteId: note.id });
  return { id: note.id };
}

export type TaskTargetResult =
  | { ok: true; created: Array<{ id: string; label: string }> }
  | { ok: false; code: 'project_not_found' | 'contact_not_found' | 'nothing_to_send' };

/** Próximos pasos elegidos → un issue de Track cada uno, con link a la reunión. */
export async function tasksToTrack(args: {
  owner: VoiceOwner;
  teamId: string | null;
  projectId: string;
  items: string[];
  meetingTitle: string;
  meetingUrl: string;
  fromLabel: string;
}): Promise<TaskTargetResult> {
  const items = args.items.map((s) => s.trim()).filter(Boolean).slice(0, 40);
  if (!items.length) return { ok: false, code: 'nothing_to_send' };
  const project = await getProject(args.projectId);
  if (!project || !canAccessTrackProject(project, args.teamId, args.owner.workspaceId)) return { ok: false, code: 'project_not_found' };
  const created: Array<{ id: string; label: string }> = [];
  for (const title of items) {
    const issue = await createIssue(
      project.id,
      args.owner.personId,
      { title: title.slice(0, 200), description: [{ type: 'text', text: `${args.fromLabel}: ${args.meetingTitle} (${args.meetingUrl})` }] },
      { source: 'app' },
    );
    created.push({ id: issue.id, label: issue.identifier });
  }
  return { ok: true, created };
}

/** Próximos pasos → tareas del CRM (con el contacto de la reunión si tiene). */
export async function tasksToCrm(args: {
  owner: VoiceOwner;
  scope: OwnerScope;
  contactId: string | null;
  items: string[];
  body: string;
}): Promise<TaskTargetResult> {
  const items = args.items.map((s) => s.trim()).filter(Boolean).slice(0, 40);
  if (!items.length) return { ok: false, code: 'nothing_to_send' };
  if (args.contactId && !(await canSeeEntity(args.owner.workspaceId, 'contact', args.contactId, args.scope))) {
    return { ok: false, code: 'contact_not_found' };
  }
  const created: Array<{ id: string; label: string }> = [];
  for (const subject of items) {
    const task = await createActivity(args.owner.workspaceId, {
      type: 'task',
      subject: subject.slice(0, 200),
      body: args.body.slice(0, 2000),
      contactId: args.contactId,
      ownerId: args.owner.personId,
    });
    created.push({ id: task.id, label: task.subject });
  }
  return { ok: true, created };
}

/**
 * Deja (o actualiza) la actividad "reunión" en el timeline del contacto con
 * el resumen. Una sola actividad por reunión: se reclama crm_activity_id con
 * compare-and-set para que dos pedidos a la vez no la dupliquen.
 */
export async function logMeetingToContact(args: {
  owner: VoiceOwner;
  scope: OwnerScope;
  detail: VoiceSessionDetail;
  labels: MeetingLabels;
}): Promise<{ ok: true; activityId: string } | { ok: false; code: 'contact_not_found' }> {
  const d = args.detail;
  if (!d.contactId || !(await canSeeEntity(args.owner.workspaceId, 'contact', d.contactId, args.scope))) {
    return { ok: false, code: 'contact_not_found' };
  }
  const body = meetingPlainText(d, args.labels).slice(0, 8000);
  const subject = (d.title || args.labels.fromVoice).slice(0, 200);
  const durationMin = Math.max(1, Math.round(d.durationMs / 60_000));
  if (d.crmActivityId && d.crmActivityId !== 'pending') {
    const updated = await updateActivity(args.owner.workspaceId, d.crmActivityId, { subject, body, durationMin });
    if (updated) return { ok: true, activityId: updated.id };
  }
  const db = getDb();
  const claim = await db
    .prepare("UPDATE voice_sessions SET crm_activity_id = 'pending' WHERE id = ? AND (crm_activity_id IS NULL OR crm_activity_id = ?)")
    .run(d.id, d.crmActivityId ?? '');
  if (!claim.changes) {
    const row = (await db.prepare('SELECT crm_activity_id FROM voice_sessions WHERE id = ?').get(d.id)) as { crm_activity_id: string | null };
    return { ok: true, activityId: row.crm_activity_id ?? '' };
  }
  try {
    const act = await createActivity(args.owner.workspaceId, {
      type: 'meeting',
      subject,
      body,
      contactId: d.contactId,
      ownerId: args.owner.personId,
      durationMin,
    });
    await updateSession(args.owner, d.id, { crmActivityId: act.id });
    return { ok: true, activityId: act.id };
  } catch (err) {
    await db.prepare("UPDATE voice_sessions SET crm_activity_id = NULL WHERE id = ? AND crm_activity_id = 'pending'").run(d.id);
    throw err;
  }
}

export interface LinkableBooking {
  id: string;
  title: string;
  inviteeName: string;
  inviteeEmail: string;
  startsAt: string;
  endsAt: string;
  meetingUrl: string | null;
}

/** Reservas de Cal de los últimos 14 días y los próximos 7 (para vincular o empezar una reunión). */
export async function listLinkableBookings(owner: VoiceOwner, now = new Date()): Promise<LinkableBooking[]> {
  const rows = await listUserBookings(owner.workspaceId, {
    status: 'confirmed',
    from: new Date(now.getTime() - 14 * 86_400_000),
    to: new Date(now.getTime() + 7 * 86_400_000),
    limit: 200,
    order: 'desc',
  });
  // Solo reservas que la persona atiende (anfitriona o co-anfitriona), sea cual sea su rol, como el calendario de Voice.
  return rows.filter((b) => attendsBooking(b, owner)).slice(0, 100).map((b) => ({
    id: b.id,
    title: b.event_type_title,
    inviteeName: b.invitee_name,
    inviteeEmail: b.invitee_email,
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    meetingUrl: b.meeting_url,
  }));
}

/**
 * Vincula una reserva de Cal: título (si no tenía) y el contacto del CRM con
 * el email del invitado (si existe y la persona lo ve).
 */
export async function linkBooking(args: {
  owner: VoiceOwner;
  scope: OwnerScope;
  sessionId: string;
  bookingId: string;
  currentTitle: string;
}): Promise<{ ok: true; title: string; contactId: string | null } | { ok: false }> {
  const booking = (await listLinkableBookings(args.owner)).find((b) => b.id === args.bookingId);
  if (!booking) {
    // Fuera de la ventana: se busca la reserva en el workspace directamente.
    const row = (await getDb()
      .prepare(
        `SELECT b.id, b.invitee_name, b.invitee_email, b.host_user_id, b.co_host_ids, e.title FROM calendar_bookings b
         JOIN calendar_event_types e ON e.id = b.event_type_id
         WHERE b.id = ? AND e.user_id = ?`,
      )
      .get(args.bookingId, args.owner.workspaceId)) as
      | { id: string; invitee_name: string; invitee_email: string; host_user_id: string | null; co_host_ids: string; title: string }
      | undefined;
    if (row && !attendsBooking(row, args.owner)) return { ok: false };
    if (!row) return { ok: false };
    return finishLink(args, `${row.title} · ${row.invitee_name}`, row.invitee_email);
  }
  return finishLink(args, `${booking.title} · ${booking.inviteeName}`, booking.inviteeEmail);
}

async function finishLink(
  args: { owner: VoiceOwner; scope: OwnerScope; sessionId: string; bookingId: string; currentTitle: string },
  title: string,
  email: string,
): Promise<{ ok: true; title: string; contactId: string | null }> {
  const contact = email ? await findContactByEmail(args.owner.workspaceId, email) : null;
  const contactId = contact && (await canSeeEntity(args.owner.workspaceId, 'contact', contact.id, args.scope)) ? contact.id : null;
  const nextTitle = args.currentTitle.trim() ? args.currentTitle : title.slice(0, 200);
  await updateSession(args.owner, args.sessionId, {
    calBookingId: args.bookingId,
    title: nextTitle,
    ...(contactId ? { contactId } : {}),
  });
  return { ok: true, title: nextTitle, contactId };
}

/** Nombre y email de un contacto (para mostrarlo en la reunión). */
export async function contactLabel(workspaceId: string, contactId: string | null): Promise<{ id: string; name: string; email: string } | null> {
  if (!contactId) return null;
  const row = (await getDb()
    .prepare('SELECT id, first_name, last_name, email FROM crm_contacts WHERE id = ? AND user_id = ?')
    .get(contactId, workspaceId)) as { id: string; first_name: string; last_name: string; email: string } | undefined;
  if (!row) return null;
  return { id: row.id, name: `${row.first_name} ${row.last_name}`.trim() || row.email, email: row.email };
}
