/**
 * Docs — recordatorios de las menciones de fecha (@recordar mañana 9:00).
 *
 * La mención vive en el HTML del bloque (lib/docs-dates.ts) con un id propio
 * (data-rid) y el instante en que avisa (data-remind). Al guardar la página,
 * syncDocReminders deja docs_reminders igual a lo que hay en el contenido: los
 * nuevos los crea para quien guardó (como en Notion, el recordatorio es de
 * quien lo pone), los movidos vuelven a quedar pendientes y los borrados se
 * van. /api/cron/minute los dispara: notificación en la campana y email. Cada
 * fila se reclama con un compare-and-set de sent_at y del remind_at leído.
 */
import { getDb } from './db';
import { appSender, escapeHtml, formatWhen, renderBrandedHtml, sendEmail } from './email';
import { createNotification } from './notifications';
import { siteUrl } from './board-urls';
import { remindersInHtml, type ParsedReminder } from './docs-dates';
import { withDatabaseBodies, type DocsBlock } from './docs-types';
import en from '@/messages/en/docs.json';
import es from '@/messages/es/docs.json';
import pt from '@/messages/pt/docs.json';

type Locale = 'en' | 'es' | 'pt';
type Strings = typeof en.reminderEmail;

const STRINGS: Record<Locale, Strings> = {
  en: en.reminderEmail,
  es: { ...en.reminderEmail, ...es.reminderEmail },
  pt: { ...en.reminderEmail, ...pt.reminderEmail },
};

const MAX_AHEAD_MS = 10 * 365 * 86_400_000;

function locale(raw: string | null | undefined): Locale {
  return raw === 'es' || raw === 'pt' ? raw : 'en';
}

function safeTimezone(raw: string | null | undefined): string {
  if (!raw) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return raw;
  } catch {
    return 'UTC';
  }
}

function fill(s: string, vars: Record<string, string>): string {
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

/** Recordatorios de todos los bloques de una página (también los cuerpos de filas). */
export function pageReminders(blocks: DocsBlock[]): ParsedReminder[] {
  const seen = new Set<string>();
  const out: ParsedReminder[] = [];
  for (const b of withDatabaseBodies(blocks)) {
    for (const texts of [b.content, b.caption ?? '']) {
      for (const r of remindersInHtml(texts)) {
        if (seen.has(r.rid)) continue;
        seen.add(r.rid);
        out.push(r);
      }
    }
  }
  return out;
}

interface ReminderRow {
  id: string;
  rid: string;
  remind_at: string;
  sent_at: string | null;
}

/** Deja docs_reminders igual a las menciones con recordatorio de la página. */
export async function syncDocReminders(opts: {
  pageId: string;
  workspaceId: string;
  actorId: string;
  blocks: DocsBlock[];
  locale?: string | null;
  timezone?: string | null;
  now?: Date;
}): Promise<void> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const wanted = pageReminders(opts.blocks).filter((r) => Date.parse(r.remindAt) <= now.getTime() + MAX_AHEAD_MS);
  const existing = (await db
    .prepare('SELECT id, rid, remind_at, sent_at FROM docs_reminders WHERE page_id = ?')
    .all(opts.pageId)) as ReminderRow[];
  const byRid = new Map(existing.map((r) => [r.rid, r]));
  const keep = new Set(wanted.map((r) => r.rid));
  for (const r of existing) {
    if (!keep.has(r.rid)) await db.prepare('DELETE FROM docs_reminders WHERE id = ?').run(r.id);
  }
  const ts = now.toISOString();
  for (const r of wanted) {
    const cur = byRid.get(r.rid);
    if (!cur) {
      await db
        .prepare(
          `INSERT INTO docs_reminders (id, page_id, rid, user_id, workspace_id, remind_at, label, timezone, locale, sent_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?) ON CONFLICT(page_id, rid) DO NOTHING`,
        )
        .run(crypto.randomUUID(), opts.pageId, r.rid, opts.actorId, opts.workspaceId, r.remindAt, r.label.slice(0, 200), safeTimezone(opts.timezone), locale(opts.locale), ts);
      continue;
    }
    // Movido a otra fecha: vuelve a avisar.
    if (cur.remind_at !== r.remindAt) {
      // Y avisa en el idioma y la zona de quien lo movió, si vinieron.
      await db
        .prepare(
          `UPDATE docs_reminders SET remind_at = ?, label = ?, sent_at = NULL,
             timezone = COALESCE(?, timezone), locale = COALESCE(?, locale) WHERE id = ?`,
        )
        .run(
          r.remindAt,
          r.label.slice(0, 200),
          opts.timezone ? safeTimezone(opts.timezone) : null,
          opts.locale ? locale(opts.locale) : null,
          cur.id,
        );
    }
  }
}

interface DueReminder {
  id: string;
  page_id: string;
  user_id: string;
  remind_at: string;
  label: string;
  timezone: string;
  locale: string;
  title: string;
  email: string | null;
}

/** Asunto, texto y HTML del email de un recordatorio de Docs. */
export function buildDocReminderEmail(r: Pick<DueReminder, 'remind_at' | 'timezone' | 'locale' | 'title' | 'label'>, link: string) {
  const s = STRINGS[locale(r.locale)];
  const title = r.title.trim() || s.untitled;
  const when = formatWhen(new Date(r.remind_at), safeTimezone(r.timezone), locale(r.locale));
  const subject = fill(s.subject, { title });
  const body = fill(s.body, { title, when });
  const text = [body, '', `${s.open}: ${link}`, '', s.why].join('\n');
  const html = renderBrandedHtml({
    heading: s.heading,
    eyebrow: 'zerosoft · docs',
    paragraphs: [
      escapeHtml(body),
      `<a href="${escapeHtml(link)}">${escapeHtml(s.open)}</a>`,
      `<span style="color:#888888;font-size:12px;">${escapeHtml(s.why)}</span>`,
    ],
  });
  return { subject, text, html };
}

/** Dispara los recordatorios vencidos (páginas fuera de la papelera). Devuelve cuántos avisó. */
export async function fireDocReminders(opts: { limit?: number; now?: Date } = {}): Promise<number> {
  const db = getDb();
  const now = (opts.now ?? new Date()).toISOString();
  const rows = (await db
    .prepare(
      `SELECT r.id, r.page_id, r.user_id, r.remind_at, r.label, r.timezone, r.locale, p.title, u.email
       FROM docs_reminders r
       JOIN docs_pages p ON p.id = r.page_id
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.sent_at IS NULL AND r.remind_at <= ? AND p.archived = 0
       ORDER BY r.remind_at ASC LIMIT ?`,
    )
    .all(now, Math.min(Math.max(opts.limit ?? 200, 1), 1000))) as DueReminder[];
  let fired = 0;
  for (const r of rows) {
    const claimed = await db
      .prepare('UPDATE docs_reminders SET sent_at = ? WHERE id = ? AND sent_at IS NULL AND remind_at = ?')
      .run(now, r.id, r.remind_at);
    if (!claimed.changes) continue;
    fired++;
    const s = STRINGS[locale(r.locale)];
    const title = r.title.trim() || s.untitled;
    // La campana dice cuándo en el idioma y la zona de quien lo puso (como el email).
    const when = formatWhen(new Date(r.remind_at), safeTimezone(r.timezone), locale(r.locale));
    await createNotification({
      userId: r.user_id,
      type: 'docs_reminder',
      title: fill(s.notification, { title }),
      body: when,
      href: `/app/docs/${encodeURIComponent(r.page_id)}`,
      sourceType: 'docs_page',
      sourceId: r.page_id,
    }).catch(() => undefined);
    if (r.email) {
      const link = `${siteUrl()}/${locale(r.locale)}/app/docs/${encodeURIComponent(r.page_id)}`;
      await sendEmail({ to: r.email, from: appSender(), ...buildDocReminderEmail(r, link) }).catch(() => undefined);
    }
  }
  return fired;
}

/** Recordatorios pendientes de una persona en una página (para el editor). */
export async function listPendingDocReminders(pageId: string): Promise<Array<{ rid: string; remind_at: string; sent_at: string | null }>> {
  return (await getDb()
    .prepare('SELECT rid, remind_at, sent_at FROM docs_reminders WHERE page_id = ?')
    .all(pageId)) as Array<{ rid: string; remind_at: string; sent_at: string | null }>;
}
