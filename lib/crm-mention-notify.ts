/**
 * CRM — avisos de @menciones en notas y tareas. Server-only.
 *
 * Cada persona mencionada (del workspace, que no sea quien escribe) recibe
 * una notificación in-app y un email con el texto y el link. Al editar solo
 * se avisa a quienes se suman como mencionados. Best effort: un email que
 * falla no corta el guardado.
 *
 * Quien no puede ver la nota o la tarea (el registro, el lead o el registro
 * de objeto quedan fuera de su alcance, o es una tarea de un chat que no ve)
 * no recibe nada: ni el texto, ni el nombre del registro, ni el link. La
 * nota se guarda igual y a quien escribe se le avisa que esa persona no fue
 * notificada (como HubSpot, que no notifica a quien no tiene acceso).
 */
import { getWorkspace, workspaceTeamId } from './workspace';
import { getDb, type CrmActivityRow } from './db';
import { escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { createNotification } from './notifications';
import { listMembers } from './teams';
import { findMentions, newMentions, type Mentionable } from './crm-mentions';
import { activityBodyText, noteMarkdownToText } from './crm-note-format';
import { canSeeActivity, canSeeOwnedRow, ownerScopeFor } from './crm-visibility';
import type { TeamRole } from './teams';

/** Persona mencionable con su rol en el team (decide qué registros ve). */
export type MentionablePerson = Mentionable & { role?: TeamRole };

type MailLocale = 'en' | 'es' | 'pt';

/** Dónde está la mención: el texto de una nota o tarea, o un comentario de una actividad (C1). */
export type MentionKind = 'note' | 'task' | 'comment';

const COPY: Record<MailLocale, { subject: string; heading: string; line: string; open: string; kinds: Record<MentionKind, string> }> = {
  en: {
    subject: '{actor} mentioned you in {kind}',
    heading: 'You were mentioned',
    line: '<strong>{actor}</strong> mentioned you in {kind} on <strong>{record}</strong>:',
    open: 'Open it in the CRM',
    kinds: { note: 'a note', task: 'a task', comment: 'a comment' },
  },
  es: {
    subject: '{actor} te mencionó en {kind}',
    heading: 'Te mencionaron',
    line: '<strong>{actor}</strong> te mencionó en {kind} de <strong>{record}</strong>:',
    open: 'Abrir en el CRM',
    kinds: { note: 'una nota', task: 'una tarea', comment: 'un comentario' },
  },
  pt: {
    subject: '{actor} mencionou você em {kind}',
    heading: 'Você foi mencionado',
    line: '<strong>{actor}</strong> mencionou você em {kind} de <strong>{record}</strong>:',
    open: 'Abrir no CRM',
    kinds: { note: 'uma nota', task: 'uma tarefa', comment: 'um comentário' },
  },
};

/** Tipos de actividad donde las menciones avisan. */
export const MENTION_TYPES: ReadonlySet<string> = new Set(['note', 'task']);

function mailLocale(l: string | null | undefined): MailLocale {
  return l === 'es' || l === 'pt' ? l : 'en';
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

/** Personas que se pueden mencionar: los miembros del team activo, o solo el dueño en un workspace personal. */
export async function mentionablePeople(
  workspace: { id: string; email: string; name: string | null; team?: { id: string } | null; workspace?: { id: string } | null },
): Promise<MentionablePerson[]> {
  // Sin sesión (cron, Flow): la ficha del workspace del owner.
  const teamId = workspaceTeamId(workspace) ?? (await getWorkspace(workspace.id))?.id ?? null;
  if (!teamId) return [{ id: workspace.id, name: workspace.name, email: workspace.email, role: 'owner' }];
  return (await listMembers(teamId)).map((m) => ({ id: m.user_id, name: m.name, email: m.email, role: m.role as TeamRole }));
}

/** Path de la actividad en la app: la tarea, o el registro donde está la nota. */
export function activityHref(a: Pick<CrmActivityRow, 'id' | 'type' | 'contact_id' | 'company_id' | 'deal_id'>): string {
  if (a.type === 'task') return `/app/crm/tasks/${a.id}`;
  if (a.deal_id) return `/app/crm/deals/${a.deal_id}`;
  if (a.contact_id) return `/app/crm/contacts/${a.contact_id}`;
  if (a.company_id) return `/app/crm/companies/${a.company_id}`;
  return '/app/crm/tasks';
}

async function recordLabel(a: Pick<CrmActivityRow, 'contact_id' | 'company_id' | 'deal_id' | 'subject'>): Promise<string> {
  const db = getDb();
  if (a.deal_id) {
    const r = (await db.prepare('SELECT name FROM crm_deals WHERE id = ?').get(a.deal_id)) as { name: string } | undefined;
    if (r?.name) return r.name;
  }
  if (a.contact_id) {
    const r = (await db
      .prepare('SELECT first_name, last_name, email FROM crm_contacts WHERE id = ?')
      .get(a.contact_id)) as { first_name: string; last_name: string; email: string } | undefined;
    const name = r ? `${r.first_name} ${r.last_name}`.trim() || r.email : '';
    if (name) return name;
  }
  if (a.company_id) {
    const r = (await db.prepare('SELECT name FROM crm_companies WHERE id = ?').get(a.company_id)) as { name: string } | undefined;
    if (r?.name) return r.name;
  }
  return a.subject || 'CRM';
}

/** La actividad con lo que decide quién la ve. */
type MentionActivity = Pick<CrmActivityRow, 'id' | 'type' | 'subject' | 'body' | 'contact_id' | 'company_id' | 'deal_id'> &
  Partial<Pick<CrmActivityRow, 'lead_id' | 'object_record_id' | 'body_format'>>;

interface NotifyOpts {
  activity: MentionActivity;
  actor: { id: string; name: string | null; email: string };
  people: MentionablePerson[];
  before?: string;
  locale?: string;
  /** Workspace dueño: si viene, solo se avisa a quien puede ver la actividad. */
  workspaceId?: string;
  /**
   * Comentario de la actividad (C1): su markdown. Las menciones se buscan ahí
   * (y en `before`, el texto anterior del comentario), y el aviso dice "un
   * comentario". Quién recibe el aviso sigue siendo quien ve la actividad.
   */
  comment?: string;
}

/** ¿La persona ve la actividad: sus registros, su lead, su registro de objeto y, si es de un chat, el chat? */
export async function personSeesActivity(workspaceId: string, activity: MentionActivity, person: MentionablePerson, locale?: string): Promise<boolean> {
  const scope = await ownerScopeFor({ workspaceId, personId: person.id, role: person.role ?? 'member' });
  if (!(await canSeeActivity(workspaceId, activity.id, scope))) return false;
  if (activity.lead_id && !(await canSeeOwnedRow(workspaceId, 'crm_leads', activity.lead_id, scope))) return false;
  if (activity.object_record_id && !(await canSeeOwnedRow(workspaceId, 'crm_object_records', activity.object_record_id, scope))) {
    return false;
  }
  // Una tarea de un chat de Lines que esa persona no ve: el aviso traería su texto (lib/crm-chat-privacy.ts).
  // Si no se puede saber qué ve, no se avisa con el texto: cuenta como que no ve el chat.
  const { isChatHidden, noChatReader, personChatReader } = await import('./crm-chat-privacy');
  const reader = await personChatReader(workspaceId, person.id, locale).catch(() => noChatReader(workspaceId, locale));
  return !(await isChatHidden(workspaceId, activity.id, reader));
}

/**
 * Para la respuesta a quien escribe: los mencionados que no ven la actividad
 * (solo su id y nombre, que ya conoce del equipo). Vacío si no hay.
 */
export function mentionsNotNotified(
  ids: string[],
  people: MentionablePerson[],
): { mentions_not_notified?: Array<{ id: string; name: string }> } {
  if (!ids.length) return {};
  return {
    mentions_not_notified: ids.map((id) => {
      const p = people.find((x) => x.id === id);
      return { id, name: p?.name?.trim() || p?.email || '' };
    }),
  };
}

/** Avisa a los mencionados (ver notifyMentionsDetailed). Devuelve a quiénes se avisó. */
export async function notifyActivityMentions(opts: NotifyOpts): Promise<string[]> {
  return (await notifyMentionsDetailed(opts)).notified;
}

/**
 * Avisa a los mencionados en la actividad. `before`: el texto anterior (al
 * editar), así solo se avisa lo nuevo. `notified`: a quiénes se avisó;
 * `withoutAccess`: mencionados que no pueden ver la actividad y no recibieron
 * nada (para decírselo a quien escribe).
 */
export async function notifyMentionsDetailed(opts: NotifyOpts): Promise<{ notified: string[]; withoutAccess: string[] }> {
  const { activity, actor, people } = opts;
  const isComment = opts.comment !== undefined;
  if (!isComment && !MENTION_TYPES.has(activity.type)) return { notified: [], withoutAccess: [] };
  const text = isComment ? (opts.comment ?? '') : `${activity.subject}\n${activity.body}`;
  const ids = (opts.before === undefined ? findMentions(text, people) : newMentions(opts.before, text, people)).filter(
    (id) => id !== actor.id,
  );
  if (!ids.length) return { notified: [], withoutAccess: [] };
  const L = COPY[mailLocale(opts.locale)];
  const actorName = actor.name?.trim() || actor.email;
  const record = await recordLabel(activity);
  const kind = L.kinds[isComment ? 'comment' : (activity.type as MentionKind)] ?? activity.type;
  const href = activityHref(activity);
  const url = `${baseUrl()}/${mailLocale(opts.locale)}${href}`;
  // Markdown (nota con formato o comentario) → texto plano: el aviso y el email no muestran marcas.
  const excerpt = (isComment ? noteMarkdownToText(opts.comment ?? '') : activityBodyText(activity) || activity.subject).slice(0, 600);
  const notified: string[] = [];
  const withoutAccess: string[] = [];
  for (const id of ids) {
    const person = people.find((p) => p.id === id);
    if (!person) continue;
    if (opts.workspaceId && !(await personSeesActivity(opts.workspaceId, activity, person, opts.locale))) {
      withoutAccess.push(id);
      continue;
    }
    notified.push(id);
    await createNotification({
      userId: id,
      type: 'mention',
      title: fill(L.subject, { actor: actorName, kind }),
      body: excerpt.slice(0, 280),
      href,
      sourceType: 'crm_activity',
      sourceId: activity.id,
      meta: { actorId: actor.id, actorName, record },
    }).catch(() => null);
    const vars = { actor: escapeHtml(actorName), kind: escapeHtml(kind), record: escapeHtml(record) };
    await sendEmail({
      to: person.email,
      subject: fill(L.subject, { actor: actorName, kind }),
      text: `${fill(L.line, { actor: actorName, kind, record }).replace(/<[^>]+>/g, '')}\n\n${excerpt}\n\n${L.open}: ${url}`,
      html: renderBrandedHtml({
        heading: L.heading,
        paragraphs: [
          fill(L.line, vars),
          escapeHtml(excerpt).replace(/\n/g, '<br>'),
          `<a href="${escapeHtml(url)}">${escapeHtml(L.open)}</a>`,
        ],
      }),
    }).catch(() => null);
  }
  return { notified, withoutAccess };
}
