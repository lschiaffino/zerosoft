/**
 * CRM — avisos de @menciones en notas y tareas. Server-only.
 *
 * Cada persona mencionada (del workspace, que no sea quien escribe) recibe
 * una notificación in-app y un email con el texto y el link. Al editar solo
 * se avisa a quienes se suman como mencionados. Best effort: un email que
 * falla no corta el guardado.
 */
import { getDb, type CrmActivityRow } from './db';
import { escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { createNotification } from './notifications';
import { listMembers } from './teams';
import { findMentions, newMentions, type Mentionable } from './crm-mentions';

type MailLocale = 'en' | 'es' | 'pt';

const COPY: Record<MailLocale, { subject: string; heading: string; line: string; open: string; kinds: Record<string, string> }> = {
  en: {
    subject: '{actor} mentioned you in a {kind}',
    heading: 'You were mentioned',
    line: '<strong>{actor}</strong> mentioned you in a {kind} on <strong>{record}</strong>:',
    open: 'Open it in the CRM',
    kinds: { note: 'note', task: 'task' },
  },
  es: {
    subject: '{actor} te mencionó en una {kind}',
    heading: 'Te mencionaron',
    line: '<strong>{actor}</strong> te mencionó en una {kind} de <strong>{record}</strong>:',
    open: 'Abrir en el CRM',
    kinds: { note: 'nota', task: 'tarea' },
  },
  pt: {
    subject: '{actor} mencionou você em uma {kind}',
    heading: 'Você foi mencionado',
    line: '<strong>{actor}</strong> mencionou você em uma {kind} de <strong>{record}</strong>:',
    open: 'Abrir no CRM',
    kinds: { note: 'nota', task: 'tarefa' },
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
  workspace: { id: string; email: string; name: string | null; team?: { id: string } | null },
): Promise<Mentionable[]> {
  if (!workspace.team?.id) return [{ id: workspace.id, name: workspace.name, email: workspace.email }];
  return (await listMembers(workspace.team.id)).map((m) => ({ id: m.user_id, name: m.name, email: m.email }));
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

/**
 * Avisa a los mencionados en la actividad. `before`: el texto anterior (al
 * editar), así solo se avisa lo nuevo. Devuelve a quiénes se avisó.
 */
export async function notifyActivityMentions(opts: {
  activity: Pick<CrmActivityRow, 'id' | 'type' | 'subject' | 'body' | 'contact_id' | 'company_id' | 'deal_id'>;
  actor: { id: string; name: string | null; email: string };
  people: Mentionable[];
  before?: string;
  locale?: string;
}): Promise<string[]> {
  const { activity, actor, people } = opts;
  if (!MENTION_TYPES.has(activity.type)) return [];
  const text = `${activity.subject}\n${activity.body}`;
  const ids = (opts.before === undefined ? findMentions(text, people) : newMentions(opts.before, text, people)).filter(
    (id) => id !== actor.id,
  );
  if (!ids.length) return [];
  const L = COPY[mailLocale(opts.locale)];
  const actorName = actor.name?.trim() || actor.email;
  const record = await recordLabel(activity);
  const kind = L.kinds[activity.type] ?? activity.type;
  const href = activityHref(activity);
  const url = `${baseUrl()}/${mailLocale(opts.locale)}${href}`;
  const excerpt = (activity.body || activity.subject).slice(0, 600);
  for (const id of ids) {
    const person = people.find((p) => p.id === id);
    if (!person) continue;
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
  return ids;
}
