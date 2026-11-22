/**
 * CRM, recordatorios de tareas (bloque A3), como el "Send reminder" de
 * HubSpot: a la hora elegida, quien tiene la tarea (sin owner, el dueño del
 * workspace) recibe un aviso in-app y un email. Lo corre el cron de cada
 * minuto; cada recordatorio se reclama (reminder_sent_at) antes de salir, así
 * dos corridas no avisan dos veces. Server-only.
 *
 * Solo le llega a quien hoy puede ver la tarea: sigue en el workspace, usa el
 * CRM y ve los registros asociados (contacto, empresa, deal, lead, registro de
 * objeto). Si la tarea salió de un chat de Lines que esa persona no ve, el
 * aviso va con el marcador en lugar del título. No se escribe nada de la
 * tarea en los logs.
 */
import { getDb, type CrmActivityRow } from './db';
import { personAppAccess } from './api-auth';
import { canUseApp } from './workspace';
import { canSeeActivity, ownerScopeFor } from './crm-visibility';
import { createNotification } from './notifications';
import { escapeHtml, formatWhen, renderBrandedHtml, sendEmail } from './email';

type MailLocale = 'en' | 'es' | 'pt';

const COPY: Record<MailLocale, { title: string; heading: string; due: string; noDue: string; open: string }> = {
  en: {
    title: 'Task reminder: {subject}',
    heading: 'Task reminder',
    due: 'Due {when}.',
    noDue: 'No due date.',
    open: 'Open the task',
  },
  es: {
    title: 'Recordatorio de tarea: {subject}',
    heading: 'Recordatorio de tarea',
    due: 'Vence el {when}.',
    noDue: 'Sin fecha de vencimiento.',
    open: 'Abrir la tarea',
  },
  pt: {
    title: 'Lembrete de tarefa: {subject}',
    heading: 'Lembrete de tarefa',
    due: 'Vence em {when}.',
    noDue: 'Sem data de vencimento.',
    open: 'Abrir a tarefa',
  },
};

function mailLocale(l: string | null | undefined): MailLocale {
  return l === 'es' || l === 'pt' ? l : 'en';
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

function nowSql(at: Date): string {
  return at.toISOString().slice(0, 19).replace('T', ' ');
}

function parseUtc(v: string): Date {
  const norm = v.trim().replace('T', ' ');
  const full = /^\d{4}-\d{2}-\d{2}$/.test(norm) ? `${norm} 00:00:00` : norm.length === 16 ? `${norm}:00` : norm.slice(0, 19);
  return new Date(`${full.replace(' ', 'T')}Z`);
}

/**
 * ¿La persona ve hoy esta tarea? Sigue en el workspace con el CRM, y ve sus
 * registros, su lead y su registro de objeto.
 */
export async function reminderRecipientSees(task: CrmActivityRow, personId: string): Promise<boolean> {
  const ws = task.user_id;
  const access = await personAppAccess(ws, personId).catch(() => null);
  if (!access || !canUseApp({ role: access.role, apps: access.apps as never }, 'crm')) return false;
  const scope = await ownerScopeFor({ workspaceId: ws, personId, role: access.role });
  // canSeeActivity ya mira contacto, empresa, deal, lead y registro de objeto (misma regla que el índice).
  return canSeeActivity(ws, task.id, scope);
}

/** Manda los recordatorios vencidos. Devuelve cuántos salieron. */
export async function fireTaskReminders(opts: { limit?: number; now?: Date } = {}): Promise<number> {
  const db = getDb();
  const at = opts.now ?? new Date();
  const now = nowSql(at);
  const rows = (await db
    .prepare(
      `SELECT * FROM crm_activities
       WHERE reminder_at IS NOT NULL AND reminder_sent_at IS NULL AND reminder_at <= ? AND type = 'task' AND done = 0
       ORDER BY reminder_at ASC LIMIT ?`,
    )
    .all(now, Math.min(Math.max(opts.limit ?? 200, 1), 1000))) as CrmActivityRow[];
  let fired = 0;
  for (const task of rows) {
    const claimed = await db
      .prepare('UPDATE crm_activities SET reminder_sent_at = ? WHERE id = ? AND reminder_sent_at IS NULL AND reminder_at = ?')
      .run(now, task.id, task.reminder_at ?? '');
    if (!claimed.changes) continue;
    const personId = task.owner_id ?? task.user_id;
    if (!(await reminderRecipientSees(task, personId).catch(() => false))) continue;
    const person = (await db.prepare('SELECT email, locale, time_zone FROM users WHERE id = ?').get(personId)) as
      | { email: string | null; locale: string | null; time_zone: string | null }
      | undefined;
    if (!person) continue;
    const L = COPY[mailLocale(person.locale)];
    // De un chat de Lines que la persona no ve: el marcador en lugar del título, sin notas.
    const { personChatReader, noChatReader, redactChatTask } = await import('./crm-chat-privacy');
    const reader = await personChatReader(task.user_id, personId, person.locale).catch(() => noChatReader(task.user_id, person.locale));
    const shown = await redactChatTask(task.user_id, task, reader);
    const subject = shown.subject.trim() || '—';
    const href = `/app/crm/tasks/${task.id}`;
    const when = task.due_at ? formatWhen(parseUtc(task.due_at), person.time_zone || 'UTC', mailLocale(person.locale)) : '';
    const dueLine = when ? fill(L.due, { when }) : L.noDue;
    fired++;
    await createNotification({
      userId: personId,
      type: 'crm_task_reminder',
      title: fill(L.title, { subject }).slice(0, 300),
      body: dueLine,
      href,
      sourceType: 'crm_activity',
      sourceId: task.id,
    }).catch(() => null);
    if (person.email) {
      const url = `${baseUrl()}/${mailLocale(person.locale)}${href}`;
      await sendEmail({
        to: person.email,
        subject: fill(L.title, { subject }).slice(0, 200),
        text: `${subject}\n\n${dueLine}\n\n${L.open}: ${url}`,
        html: renderBrandedHtml({
          heading: L.heading,
          paragraphs: [
            `<strong>${escapeHtml(subject)}</strong>`,
            escapeHtml(dueLine),
            `<a href="${escapeHtml(url)}">${escapeHtml(L.open)}</a>`,
          ],
        }),
      }).catch(() => null);
    }
  }
  return fired;
}
