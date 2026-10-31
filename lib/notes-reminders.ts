/**
 * Notes — recordatorios con fecha y hora (uno por nota, como Evernote).
 *
 * Al vencer, /api/cron/minute (y el tick horario, para self-host) crea una
 * notificación in-app para la persona dueña de la nota y le manda un email.
 * Cada fila se reclama con un compare-and-set de sent_at (y el remind_at
 * leído): dos crons a la vez no avisan dos veces, y si la persona movió el
 * recordatorio mientras tanto, el claim viejo no lo pisa. Las notas en la
 * papelera no avisan.
 */
import { personAppAccess } from './api-auth';
import { getDb } from './db';
import { canUseApp } from './workspace';
import { escapeHtml, formatWhen, renderBrandedHtml, sendEmail } from './email';
import { createNotification } from './notifications';
import { siteUrl } from './board-urls';
import { makeSnippet } from './notes-types';
import en from '@/messages/en/notes.json';
import es from '@/messages/es/notes.json';
import pt from '@/messages/pt/notes.json';

export type ReminderLocale = 'en' | 'es' | 'pt';

type ReminderStrings = typeof en.reminderEmail;

const STRINGS: Record<ReminderLocale, ReminderStrings> = {
  en: en.reminderEmail,
  es: { ...en.reminderEmail, ...es.reminderEmail },
  pt: { ...en.reminderEmail, ...pt.reminderEmail },
};

/** Hasta cuánto en el futuro se acepta un recordatorio. */
export const REMINDER_MAX_AHEAD_MS = 10 * 365 * 86_400_000;
/** Margen hacia atrás (relojes desfasados, "en 1 minuto"). */
export const REMINDER_PAST_GRACE_MS = 60_000;

export interface NoteReminder {
  at: string;
  sent_at: string | null;
}

interface Owner {
  workspaceId: string;
  personId: string;
}

export function reminderLocale(raw: string | null | undefined): ReminderLocale {
  return raw === 'es' || raw === 'pt' ? raw : 'en';
}

/** Zona horaria IANA válida (para el email) o UTC. */
export function safeTimezone(raw: string | null | undefined): string {
  if (!raw) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return raw;
  } catch {
    return 'UTC';
  }
}

export class ReminderError extends Error {
  constructor(public code: 'invalid_date' | 'reminder_in_past' | 'note_not_found' | 'note_trashed') {
    super(code);
  }
}

export async function getNoteReminder(owner: Owner, noteId: string): Promise<NoteReminder | null> {
  const row = (await getDb()
    .prepare('SELECT remind_at, sent_at FROM note_reminders WHERE note_id = ? AND workspace_id = ? AND person_id = ?')
    .get(noteId, owner.workspaceId, owner.personId)) as { remind_at: string; sent_at: string | null } | undefined;
  return row ? { at: row.remind_at, sent_at: row.sent_at } : null;
}

/** Crea o mueve el recordatorio de la nota (vuelve a quedar pendiente). */
export async function setNoteReminder(
  owner: Owner,
  noteId: string,
  input: { at: string; timezone?: string | null; locale?: string | null },
  now = new Date(),
): Promise<NoteReminder> {
  const at = new Date(input.at);
  if (!Number.isFinite(at.getTime())) throw new ReminderError('invalid_date');
  if (at.getTime() < now.getTime() - REMINDER_PAST_GRACE_MS) throw new ReminderError('reminder_in_past');
  if (at.getTime() > now.getTime() + REMINDER_MAX_AHEAD_MS) throw new ReminderError('invalid_date');
  const db = getDb();
  const note = (await db
    .prepare('SELECT trashed_at FROM notes WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .get(noteId, owner.workspaceId, owner.personId)) as { trashed_at: string | null } | undefined;
  if (!note) throw new ReminderError('note_not_found');
  if (note.trashed_at) throw new ReminderError('note_trashed');
  const iso = at.toISOString();
  const ts = now.toISOString();
  await db
    .prepare(
      `INSERT INTO note_reminders (note_id, workspace_id, person_id, remind_at, timezone, locale, sent_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(note_id) DO UPDATE SET remind_at = excluded.remind_at, timezone = excluded.timezone,
         locale = excluded.locale, sent_at = NULL, updated_at = excluded.updated_at`,
    )
    .run(noteId, owner.workspaceId, owner.personId, iso, safeTimezone(input.timezone), reminderLocale(input.locale), ts, ts);
  return { at: iso, sent_at: null };
}

export async function clearNoteReminder(owner: Owner, noteId: string): Promise<boolean> {
  const res = await getDb()
    .prepare('DELETE FROM note_reminders WHERE note_id = ? AND workspace_id = ? AND person_id = ?')
    .run(noteId, owner.workspaceId, owner.personId);
  return res.changes > 0;
}

function fill(s: string, vars: Record<string, string>): string {
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

export interface DueReminder {
  note_id: string;
  person_id: string;
  remind_at: string;
  timezone: string;
  locale: string;
  title: string;
  body_text: string;
  email: string | null;
}

/** Asunto, texto y HTML del email de un recordatorio. */
export function buildReminderEmail(r: DueReminder, link: string): { subject: string; text: string; html: string } {
  const s = STRINGS[reminderLocale(r.locale)];
  const title = r.title.trim() || s.untitled;
  const when = formatWhen(new Date(r.remind_at), safeTimezone(r.timezone), reminderLocale(r.locale));
  const snippet = makeSnippet(r.body_text, 280);
  const subject = fill(s.subject, { title });
  const text = [fill(s.body, { title, when }), '', ...(snippet ? [snippet, ''] : []), `${s.open}: ${link}`, '', s.why].join('\n');
  const html = renderBrandedHtml({
    heading: s.heading,
    eyebrow: 'zerosoft · notes',
    paragraphs: [
      escapeHtml(fill(s.body, { title, when })),
      ...(snippet ? [`<span style="display:block;border-left:2px solid #e5e5e5;padding:2px 0 2px 12px;">${escapeHtml(snippet)}</span>`] : []),
      `<a href="${escapeHtml(link)}">${escapeHtml(s.open)}</a>`,
      `<span style="color:#888888;font-size:12px;">${escapeHtml(s.why)}</span>`,
    ],
  });
  return { subject, text, html };
}

/** Link absoluto a la nota (en el idioma del recordatorio). */
export function reminderLink(r: Pick<DueReminder, 'note_id' | 'locale'>): string {
  return `${siteUrl()}/${reminderLocale(r.locale)}/app/notes?note=${encodeURIComponent(r.note_id)}`;
}

/** Dispara los recordatorios vencidos. Devuelve cuántos se avisaron. */
export async function fireNoteReminders(opts: { limit?: number; now?: Date } = {}): Promise<number> {
  const db = getDb();
  const now = (opts.now ?? new Date()).toISOString();
  const rows = (await db
    .prepare(
      `SELECT r.note_id, r.person_id, r.remind_at, r.timezone, r.locale, n.title, n.body_text, u.email, n.person_id AS note_owner, n.workspace_id
       FROM note_reminders r
       JOIN notes n ON n.id = r.note_id
       LEFT JOIN users u ON u.id = r.person_id
       WHERE r.sent_at IS NULL AND r.remind_at <= ? AND n.trashed_at IS NULL
       ORDER BY r.remind_at ASC LIMIT ?`,
    )
    .all(now, Math.min(Math.max(opts.limit ?? 200, 1), 1000))) as Array<DueReminder & { note_owner: string; workspace_id: string }>;
  let fired = 0;
  for (const r of rows) {
    const claimed = await db
      .prepare('UPDATE note_reminders SET sent_at = ? WHERE note_id = ? AND sent_at IS NULL AND remind_at = ?')
      .run(now, r.note_id, r.remind_at);
    if (!claimed.changes) continue;
    // El texto de la nota solo le llega a quien hoy es su dueño y sigue en el workspace.
    if (r.person_id !== r.note_owner) continue;
    const access = await personAppAccess(r.workspace_id, r.person_id).catch(() => null);
    if (!access || !canUseApp({ role: access.role, apps: access.apps as never }, 'notes')) continue;
    fired++;
    const s = STRINGS[reminderLocale(r.locale)];
    const title = r.title.trim() || s.untitled;
    await createNotification({
      userId: r.person_id,
      type: 'note_reminder',
      title: fill(s.notification, { title }),
      body: makeSnippet(r.body_text) || undefined,
      href: `/app/notes?note=${encodeURIComponent(r.note_id)}`,
      sourceType: 'note',
      sourceId: r.note_id,
    }).catch(() => undefined);
    if (r.email) {
      const mail = buildReminderEmail(r, reminderLink(r));
      await sendEmail({ to: r.email, ...mail }).catch(() => undefined);
    }
  }
  return fired;
}
