/**
 * CRM, email diario con las tareas del día (bloque A3), como el "daily task
 * digest" de HubSpot: quien lo activa recibe a la mañana (desde las 8 de su
 * zona horaria) la lista de sus tareas abiertas vencidas y de hoy. Lo corre
 * el cron de cada hora; last_sent_on (la fecha local) reclama el envío del
 * día, así dos corridas no mandan dos emails. Server-only.
 *
 * Solo entran tareas que la persona ve hoy (sus registros, con la
 * visibilidad del workspace) y las de un chat de Lines que no ve van con el
 * marcador. Si ya no está en el workspace o no usa el CRM, no sale nada.
 */
import { getDb, type Db } from './db';
import { personAppAccess } from './api-auth';
import { canUseApp } from './workspace';
import { ownerScopeFor } from './crm-visibility';
import { taskFilterWhere } from './crm-tasks-index';
import { dayRangeUtc, isValidTimeZone, tzOffsetMinutes } from './user-tz';
import { escapeHtml, renderBrandedHtml, sendEmail } from './email';

type MailLocale = 'en' | 'es' | 'pt';

const COPY: Record<MailLocale, { subject: string; heading: string; intro: string; overdue: string; more: string; open: string; off: string }> = {
  en: {
    subject: 'Your tasks for today ({count})',
    heading: 'Your tasks for today',
    intro: 'Open tasks assigned to you that are overdue or due today:',
    overdue: 'overdue',
    more: 'And {count} more.',
    open: 'Open your tasks',
    off: 'You get this email because you turned on the daily task email in the CRM. Turn it off on the Tasks page.',
  },
  es: {
    subject: 'Tus tareas de hoy ({count})',
    heading: 'Tus tareas de hoy',
    intro: 'Tareas abiertas asignadas a vos, vencidas o que vencen hoy:',
    overdue: 'vencida',
    more: 'Y {count} más.',
    open: 'Abrir tus tareas',
    off: 'Te llega este email porque activaste el email diario de tareas en el CRM. Lo podés apagar en la página de Tareas.',
  },
  pt: {
    subject: 'Suas tarefas de hoje ({count})',
    heading: 'Suas tarefas de hoje',
    intro: 'Tarefas abertas atribuídas a você, vencidas ou que vencem hoje:',
    overdue: 'vencida',
    more: 'E mais {count}.',
    open: 'Abrir suas tarefas',
    off: 'Você recebe este email porque ativou o email diário de tarefas no CRM. Desative na página de Tarefas.',
  },
};

const DIGEST_HOUR = 8;
const MAX_LISTED = 30;

function mailLocale(l: string | null | undefined): MailLocale {
  return l === 'es' || l === 'pt' ? l : 'en';
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

/** Fecha y hora local en `tz` ('YYYY-MM-DD', hora 0-23). */
export function localDayHour(tz: string, at: Date): { day: string; hour: number } {
  const local = new Date(at.getTime() + tzOffsetMinutes(tz, at) * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { day: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`, hour: local.getUTCHours() };
}

export async function getTaskDigest(workspaceId: string, personId: string, db: Db = getDb()): Promise<boolean> {
  const row = (await db.prepare('SELECT enabled FROM crm_task_digests WHERE user_id = ? AND person_id = ?').get(workspaceId, personId)) as
    | { enabled: number }
    | undefined;
  return row?.enabled === 1;
}

export async function setTaskDigest(workspaceId: string, personId: string, enabled: boolean, db: Db = getDb()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO crm_task_digests (user_id, person_id, enabled, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, person_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
    )
    .run(workspaceId, personId, enabled ? 1 : 0);
}

interface DigestTask {
  id: string;
  subject: string;
  body: string;
  due_at: string | null;
}

/** Las tareas del email de una persona: abiertas, suyas, vencidas o de hoy, que hoy ve. */
export async function digestTasksFor(workspaceId: string, personId: string, tz: string, at: Date, locale: string | null): Promise<DigestTask[] | null> {
  const access = await personAppAccess(workspaceId, personId).catch(() => null);
  if (!access || !canUseApp({ role: access.role, apps: access.apps as never }, 'crm')) return null;
  const ownerScope = await ownerScopeFor({ workspaceId, personId, role: access.role });
  const { personChatReader, noChatReader, redactChatTasks } = await import('./crm-chat-privacy');
  const chatReader = await personChatReader(workspaceId, personId, locale).catch(() => noChatReader(workspaceId, locale));
  const filter = await taskFilterWhere(
    { bucket: 'all' },
    { workspaceId, viewer: { workspaceId, personId, role: access.role }, ownerScope, chatReader, timeZone: tz, now: at },
  );
  filter.where.push('COALESCE(a.owner_id, a.user_id) = ?', 'a.due_at IS NOT NULL', 'a.due_at <= ?');
  filter.args.push(personId, dayRangeUtc(tz, at).end);
  const rows = (await getDb()
    .prepare(
      `SELECT a.id, a.subject, a.body, a.due_at FROM crm_activities a
       LEFT JOIN crm_contacts c ON c.id = a.contact_id
       LEFT JOIN crm_companies co ON co.id = a.company_id
       LEFT JOIN crm_deals d ON d.id = a.deal_id
       WHERE ${filter.where.join(' AND ')}
       ORDER BY a.due_at ASC LIMIT 200`,
    )
    .all(...filter.args)) as DigestTask[];
  return redactChatTasks(workspaceId, rows, chatReader);
}

/** Manda los emails del día que tocan a esta hora. Devuelve cuántos salieron. */
export async function runTaskDigests(opts: { now?: Date; limit?: number; budgetMs?: number } = {}): Promise<number> {
  const db = getDb();
  const at = opts.now ?? new Date();
  const prefs = (await db
    .prepare(
      `SELECT g.user_id, g.person_id, g.last_sent_on, u.email, u.locale, u.time_zone
       FROM crm_task_digests g JOIN users u ON u.id = g.person_id
       WHERE g.enabled = 1 AND (g.last_sent_on IS NULL OR g.last_sent_on < date('now', '+1 day'))
       ORDER BY COALESCE(g.last_sent_on, '') ASC
       LIMIT ?`,
    )
    .all(Math.min(opts.limit ?? 2000, 5000))) as Array<{
    user_id: string;
    person_id: string;
    last_sent_on: string | null;
    email: string | null;
    locale: string | null;
    time_zone: string | null;
  }>;
  let sent = 0;
  // Tope de tiempo por corrida: lo que no entra sale en la próxima (los que hace más que no reciben, primero).
  const deadline = Date.now() + (opts.budgetMs ?? 40_000);
  for (const p of prefs) {
    if (Date.now() > deadline) break;
    const tz = p.time_zone && isValidTimeZone(p.time_zone) ? p.time_zone : 'UTC';
    const { day, hour } = localDayHour(tz, at);
    if (hour < DIGEST_HOUR || p.last_sent_on === day) continue;
    const claimed = await db
      .prepare(
        'UPDATE crm_task_digests SET last_sent_on = ? WHERE user_id = ? AND person_id = ? AND enabled = 1 AND (last_sent_on IS NULL OR last_sent_on <> ?)',
      )
      .run(day, p.user_id, p.person_id, day);
    if (!claimed.changes || !p.email) continue;
    const tasks = await digestTasksFor(p.user_id, p.person_id, tz, at, p.locale).catch(() => null);
    if (!tasks || !tasks.length) continue;
    const L = COPY[mailLocale(p.locale)];
    const todayStart = dayRangeUtc(tz, at).start;
    const fmt = new Intl.DateTimeFormat(mailLocale(p.locale), { timeStyle: 'short', dateStyle: 'medium', timeZone: tz });
    const line = (task: DigestTask) => {
      const due = task.due_at ? new Date(`${task.due_at.trim().replace(' ', 'T').slice(0, 16)}:00Z`) : null;
      const when = due && !Number.isNaN(due.getTime()) ? fmt.format(due) : '';
      const late = task.due_at && task.due_at < todayStart ? ` (${L.overdue})` : '';
      return { text: `${task.subject.trim() || '—'} · ${when}${late}`, href: `${baseUrl()}/${mailLocale(p.locale)}/app/crm/tasks/${task.id}` };
    };
    const listed = tasks.slice(0, MAX_LISTED).map(line);
    const rest = tasks.length - listed.length;
    const url = `${baseUrl()}/${mailLocale(p.locale)}/app/crm/tasks?sv=today`;
    sent++;
    await sendEmail({
      to: p.email,
      subject: fill(L.subject, { count: String(tasks.length) }),
      text: [L.intro, '', ...listed.map((l) => `- ${l.text}`), ...(rest > 0 ? ['', fill(L.more, { count: String(rest) })] : []), '', `${L.open}: ${url}`, '', L.off].join('\n'),
      html: renderBrandedHtml({
        heading: L.heading,
        paragraphs: [
          escapeHtml(L.intro),
          listed.map((l) => `<a href="${escapeHtml(l.href)}">${escapeHtml(l.text)}</a>`).join('<br>'),
          ...(rest > 0 ? [escapeHtml(fill(L.more, { count: String(rest) }))] : []),
          `<a href="${escapeHtml(url)}">${escapeHtml(L.open)}</a>`,
          `<span style="color:#666">${escapeHtml(L.off)}</span>`,
        ],
      }),
    }).catch(() => null);
  }
  return sent;
}
