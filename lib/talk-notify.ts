/**
 * Talk: avisos y trabajos del cron.
 *
 * Quién recibe aviso (campana) cuando llega un mensaje, como en Slack:
 *  - DMs y grupos de DM: todas las personas del DM;
 *  - @menciones (personas o grupos), @canal y @aquí (solo las activas);
 *  - respuestas en hilos que la persona sigue;
 *  - palabras clave de sus preferencias;
 *  - "todos los mensajes" si lo eligió para el canal (o en general).
 * Un canal silenciado (notify = none) solo avisa las menciones directas; la
 * preferencia general "nada" no avisa nada.
 *
 * Email: con la preferencia "menciones y DMs" (por defecto), lo que siga sin
 * leer después de TALK_EMAIL_DELAY_MS sale por email desde el cron de cada
 * minuto (claim por fila en talk_email_queue.sent_at). Con "no molestar"
 * activo no se encola email.
 *
 * Cron: recordatorios vencidos (claim por sent_at), mensajes programados
 * (claim por status pending → sending) y la poda del feed de eventos.
 */
import { getDb } from './db';
import { appSender, escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { createNotification, type NotificationType } from './notifications';
import { siteUrl } from './board-urls';
import { talkPlainText } from './talk-markdown';
import {
  afterPost,
  emitTalkEvent,
  isWorkspacePerson,
  readableChannel,
  listTalkPeople,
  listTalkGroups,
  nowIso,
  postMessage,
  type TalkActor,
  type TalkChannelRow,
  type TalkMessageRow,
} from './talk';
import { ACTIVE_MS } from './talk-extras';
import en from '@/messages/en/talk.json';
import es from '@/messages/es/talk.json';
import pt from '@/messages/pt/talk.json';

export const TALK_EMAIL_DELAY_MS = 2 * 60_000;

type Locale = 'en' | 'es' | 'pt';
type MailStrings = typeof en.email;
const MAIL: Record<Locale, MailStrings> = {
  en: en.email,
  es: { ...en.email, ...es.email },
  pt: { ...en.email, ...pt.email },
};

type Reason = 'dm' | 'mention' | 'thread' | 'keyword' | 'all';
const TYPE: Record<Reason, NotificationType> = { dm: 'talk_dm', mention: 'talk_mention', thread: 'talk_thread', keyword: 'talk_keyword', all: 'talk_message' };

const inList = (n: number) => Array.from({ length: n }, () => '?').join(', ');

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

export function talkHref(channelId: string, messageId: string, parentId: string | null): string {
  return `/app/talk/${channelId}?m=${parentId ?? messageId}${parentId ? `&thread=${parentId}` : ''}`;
}

async function namesFor(workspaceId: string) {
  const people = await listTalkPeople(workspaceId);
  const byId = new Map(people.map((p) => [p.id, p]));
  const channels = (await getDb().prepare("SELECT id, name FROM talk_channels WHERE workspace_id = ? AND kind IN ('public', 'private')").all(workspaceId)) as Array<{
    id: string;
    name: string;
  }>;
  const chan = new Map(channels.map((c) => [c.id, c.name]));
  const groups = new Map((await listTalkGroups(workspaceId)).map((g) => [g.id, g.handle]));
  return {
    byId,
    names: { user: (id: string) => byId.get(id)?.name, channel: (id: string) => chan.get(id), group: (id: string) => groups.get(id) },
  };
}

function channelLabel(channel: TalkChannelRow): string {
  return channel.kind === 'dm' || channel.kind === 'group' ? '' : `#${channel.name}`;
}

/** Avisos de un mensaje nuevo. */
export async function notifyForMessage(actor: TalkActor, row: TalkMessageRow, channel: TalkChannelRow, opts: { asBot?: boolean } = {}): Promise<number> {
  const db = getDb();
  const author = opts.asBot ? null : row.user_id;
  const members = (await db.prepare('SELECT user_id, notify FROM talk_members WHERE channel_id = ?').all(channel.id)) as Array<{ user_id: string; notify: string }>;
  const memberSet = new Map(members.map((m) => [m.user_id, m.notify]));
  const { byId, names } = await namesFor(actor.workspaceId);
  const ids = [...new Set([...members.map((m) => m.user_id), ...parseJson<string[]>(row.mentions, [])])].filter((u) => u !== author);
  if (!ids.length) return 0;
  const prefs = new Map(
    ((await db
      .prepare(`SELECT user_id, notify, email, keywords, locale FROM talk_prefs WHERE workspace_id = ? AND user_id IN (${inList(ids.length)})`)
      .all(actor.workspaceId, ...ids)) as Array<{ user_id: string; notify: string; email: string; keywords: string; locale: string | null }>).map((p) => [p.user_id, p]),
  );
  const presence = new Map(
    ((await db
      .prepare(`SELECT user_id, last_seen_at, away, dnd_until FROM talk_presence WHERE workspace_id = ? AND user_id IN (${inList(ids.length)})`)
      .all(actor.workspaceId, ...ids)) as Array<{ user_id: string; last_seen_at: string | null; away: number; dnd_until: string | null }>).map((p) => [p.user_id, p]),
  );
  const now = Date.now();
  const active = (uid: string) => {
    const p = presence.get(uid);
    return !!p && !p.away && !!p.last_seen_at && now - new Date(p.last_seen_at).getTime() < ACTIVE_MS;
  };
  const followers = row.parent_id
    ? new Set(((await db.prepare('SELECT user_id FROM talk_thread_follows WHERE message_id = ?').all(row.parent_id)) as Array<{ user_id: string }>).map((f) => f.user_id))
    : new Set<string>();
  const text = talkPlainText(row.body, names);
  const lower = text.toLowerCase();
  const mentioned = new Set(parseJson<string[]>(row.mentions, []));
  const isDm = channel.kind === 'dm' || channel.kind === 'group';
  const recipients = new Map<string, Reason>();
  for (const uid of ids) {
    // Solo personas que siguen en el workspace (quien salió no recibe nada, ni de sus DMs).
    if (!byId.has(uid)) continue;
    const p = prefs.get(uid);
    if (p?.notify === 'none') continue;
    const memberNotify = memberSet.get(uid);
    const isMember = memberNotify !== undefined;
    // Solo quien puede leer el canal: miembros, o cualquiera del workspace si es público.
    if (!isMember && !(channel.kind === 'public' && byId.has(uid))) continue;
    if (mentioned.has(uid)) {
      recipients.set(uid, 'mention');
      continue;
    }
    if (!isMember) continue;
    const muted = memberNotify === 'none';
    if (isDm && !muted && (!row.parent_id || row.also_in_channel || followers.has(uid))) {
      recipients.set(uid, 'dm');
      continue;
    }
    if (muted) continue;
    if (row.broadcast === 'channel' || (row.broadcast === 'here' && active(uid))) {
      recipients.set(uid, 'mention');
      continue;
    }
    if (row.parent_id && followers.has(uid)) {
      recipients.set(uid, 'thread');
      continue;
    }
    const keywords = (p?.keywords ?? '').split(',').map((k) => k.trim()).filter(Boolean);
    if (keywords.some((k) => lower.includes(k))) {
      recipients.set(uid, 'keyword');
      continue;
    }
    const wantsAll = memberNotify === 'all' || (memberNotify === 'default' && p?.notify === 'all');
    if (wantsAll && (!row.parent_id || row.also_in_channel)) recipients.set(uid, 'all');
  }
  const actorName = row.bot_name || (author ? byId.get(author)?.name : null) || 'Someone';
  const where = channelLabel(channel);
  const href = talkHref(channel.id, row.id, row.parent_id);
  for (const [uid, reason] of recipients) {
    const n = await createNotification({
      userId: uid,
      type: TYPE[reason],
      title: where ? `${actorName} · ${where}` : actorName,
      body: text.slice(0, 280),
      href,
      sourceType: 'talk_message',
      sourceId: row.id,
      meta: { actorName, channelId: channel.id, channelName: channel.name, channelKind: channel.kind, reason, messageAt: row.created_at, threadId: row.parent_id ?? '' },
    });
    const p = prefs.get(uid);
    const dnd = presence.get(uid)?.dnd_until;
    const inDnd = !!dnd && new Date(dnd).getTime() > now;
    if ((reason === 'dm' || reason === 'mention') && (p?.email ?? 'mentions') === 'mentions' && !inDnd) {
      await db.prepare('INSERT OR IGNORE INTO talk_email_queue (notification_id, user_id, due_at) VALUES (?, ?, ?)').run(n.id, uid, new Date(now + TALK_EMAIL_DELAY_MS).toISOString());
    }
  }
  return recipients.size;
}

/** Menciones que se agregaron al editar: solo esas personas. */
export async function notifyMentionsAdded(actor: TalkActor, row: TalkMessageRow, channel: TalkChannelRow, added: string[]): Promise<void> {
  await notifyForMessage(actor, { ...row, mentions: JSON.stringify(added), broadcast: null, parent_id: row.parent_id }, channel).catch(() => 0);
}

// ---------- Email ----------

/** ¿La persona todavía puede ver lo que dice este aviso? (sigue en el workspace y lee el canal). */
async function stillAllowed(userId: string, meta: Record<string, string>): Promise<boolean> {
  const db = getDb();
  let ws = meta.workspaceId ?? '';
  if (meta.channelId) {
    const ch = (await db.prepare('SELECT workspace_id FROM talk_channels WHERE id = ?').get(meta.channelId)) as { workspace_id: string } | undefined;
    if (!ch) return false;
    ws = ch.workspace_id;
    return !!(await readableChannel({ workspaceId: ws, personId: userId, role: 'member', teamId: null }, meta.channelId));
  }
  return ws ? isWorkspacePerson(ws, userId) : true;
}

function mailLocale(raw: string | null | undefined): Locale {
  return raw === 'es' || raw === 'pt' ? raw : 'en';
}

export async function sendTalkEmails(opts: { limit?: number; now?: Date } = {}): Promise<{ sent: number; skipped: number }> {
  const db = getDb();
  const now = (opts.now ?? new Date()).toISOString();
  const rows = (await db
    .prepare(
      `SELECT q.notification_id, q.user_id, n.title, n.body, n.href, n.read_at, n.meta, n.type, u.email, p.locale
       FROM talk_email_queue q JOIN notifications n ON n.id = q.notification_id JOIN users u ON u.id = q.user_id
       LEFT JOIN talk_prefs p ON p.user_id = q.user_id AND p.workspace_id = (SELECT workspace_id FROM talk_channels WHERE id = json_extract(n.meta, '$.channelId'))
       WHERE q.sent_at IS NULL AND q.due_at <= ? ORDER BY q.due_at LIMIT ?`,
    )
    .all(now, opts.limit ?? 100)) as Array<{
    notification_id: string;
    user_id: string;
    title: string;
    body: string | null;
    href: string | null;
    read_at: string | null;
    meta: string;
    type: string;
    email: string;
    locale: string | null;
  }>;
  let sent = 0;
  let skipped = 0;
  for (const r of rows) {
    const claim = await db.prepare('UPDATE talk_email_queue SET sent_at = ? WHERE notification_id = ? AND sent_at IS NULL').run(now, r.notification_id);
    if (!claim.changes) continue;
    const meta = parseJson<Record<string, string>>(r.meta, {});
    // Ya lo vio (aviso leído o canal leído después del mensaje): no sale.
    if (r.read_at) {
      skipped++;
      continue;
    }
    // Al momento de mandar: la persona sigue en el workspace y puede leer el canal.
    if (!(await stillAllowed(r.user_id, meta))) {
      skipped++;
      continue;
    }
    if (meta.channelId && meta.messageAt) {
      const m = (await db.prepare('SELECT last_read_at FROM talk_members WHERE channel_id = ? AND user_id = ?').get(meta.channelId, r.user_id)) as { last_read_at: string | null } | undefined;
      if (!meta.threadId && m?.last_read_at && m.last_read_at >= meta.messageAt) {
        skipped++;
        continue;
      }
    }
    const loc = mailLocale(r.locale);
    const L = MAIL[loc];
    const vars = { actor: meta.actorName ?? '', channel: meta.channelName ?? '', text: (r.body ?? '').slice(0, 80) };
    const subject =
      r.type === 'talk_reminder' ? fill(L.reminderSubject, vars) : r.type === 'talk_dm' ? fill(L.dmSubject, vars) : meta.channelName ? fill(L.mentionSubject, vars) : fill(L.dmSubject, vars);
    const url = `${siteUrl()}/${loc}${r.href ?? '/app/talk'}`;
    const html = renderBrandedHtml({
      heading: subject,
      eyebrow: 'zerosoft · talk',
      paragraphs: [
        escapeHtml(r.body ?? '').replace(/\n/g, '<br>'),
        `<a href="${escapeHtml(url)}">${escapeHtml(L.open)}</a>`,
        `<span style="color:#888888;font-size:12px;">${escapeHtml(L.footer)}</span>`,
      ],
    });
    const res = await sendEmail({ from: appSender(), to: r.email, subject, html, text: `${r.body ?? ''}\n\n${L.open}: ${url}` }).catch(() => ({ ok: false }));
    if (res.ok) sent++;
  }
  return { sent, skipped };
}

// ---------- Recordatorios ----------

export async function fireTalkReminders(opts: { limit?: number; now?: Date } = {}): Promise<number> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const rows = (await db
    .prepare('SELECT * FROM talk_reminders WHERE sent_at IS NULL AND remind_at <= ? ORDER BY remind_at LIMIT ?')
    .all(now.toISOString(), opts.limit ?? 200)) as Array<{ id: string; workspace_id: string; user_id: string; message_id: string | null; text: string; remind_at: string }>;
  let fired = 0;
  for (const r of rows) {
    const claim = await db.prepare('UPDATE talk_reminders SET sent_at = ? WHERE id = ? AND sent_at IS NULL').run(now.toISOString(), r.id);
    if (!claim.changes) continue;
    let href = '/app/talk?view=later';
    let body = r.text;
    let meta: Record<string, string> = { reason: 'reminder', workspaceId: r.workspace_id };
    // Quien ya no está en el workspace no recibe el recordatorio.
    if (!(await isWorkspacePerson(r.workspace_id, r.user_id))) continue;
    if (r.message_id) {
      const m = (await db.prepare('SELECT m.*, c.name AS c_name, c.kind AS c_kind FROM talk_messages m JOIN talk_channels c ON c.id = m.channel_id WHERE m.id = ?').get(r.message_id)) as
        | (TalkMessageRow & { c_name: string; c_kind: string })
        | undefined;
      // Sin acceso al canal ahora (salió de un privado): no sale el texto del mensaje.
      if (m && !(await readableChannel({ workspaceId: r.workspace_id, personId: r.user_id, role: 'member', teamId: null }, m.channel_id))) continue;
      if (!m) continue;
      if (m) {
        const { names } = await namesFor(r.workspace_id);
        href = talkHref(m.channel_id, m.id, m.parent_id);
        body = r.text || talkPlainText(m.body, names).slice(0, 280);
        meta = { reason: 'reminder', workspaceId: r.workspace_id, channelId: m.channel_id, channelName: m.c_kind === 'public' || m.c_kind === 'private' ? m.c_name : '' };
      }
    }
    const n = await createNotification({
      userId: r.user_id,
      type: 'talk_reminder',
      title: `⏰ ${body.slice(0, 120)}`,
      body,
      href,
      sourceType: 'talk_reminder',
      sourceId: r.id,
      meta,
    });
    const prefs = (await db.prepare('SELECT email FROM talk_prefs WHERE workspace_id = ? AND user_id = ?').get(r.workspace_id, r.user_id)) as { email: string } | undefined;
    if ((prefs?.email ?? 'mentions') === 'mentions') {
      await db.prepare('INSERT OR IGNORE INTO talk_email_queue (notification_id, user_id, due_at) VALUES (?, ?, ?)').run(n.id, r.user_id, now.toISOString());
    }
    await emitTalkEvent(r.workspace_id, 'saved', { userId: r.user_id, payload: { reminder: r.id, fired: true } });
    fired++;
  }
  return fired;
}

// ---------- Programados ----------

export async function sendScheduledMessages(opts: { limit?: number; now?: Date } = {}): Promise<{ sent: number; failed: number }> {
  const db = getDb();
  const now = (opts.now ?? new Date()).toISOString();
  const rows = (await db
    .prepare("SELECT * FROM talk_scheduled WHERE status = 'pending' AND send_at <= ? ORDER BY send_at LIMIT ?")
    .all(now, opts.limit ?? 100)) as Array<{ id: string; workspace_id: string; user_id: string; channel_id: string; parent_id: string | null; body: string; files: string }>;
  let sent = 0;
  let failed = 0;
  const { workspaceRole } = await import('./api-auth');
  for (const r of rows) {
    const claim = await db.prepare("UPDATE talk_scheduled SET status = 'sending', claimed_at = ? WHERE id = ? AND status = 'pending'").run(now, r.id);
    if (!claim.changes) continue;
    try {
      const actor: TalkActor = { workspaceId: r.workspace_id, personId: r.user_id, role: await workspaceRole(r.workspace_id, r.user_id), teamId: null };
      const result = await postMessage(actor, { channelId: r.channel_id, parentId: r.parent_id, body: r.body, fileIds: parseJson<string[]>(r.files, []), scheduled: true });
      await db.prepare("UPDATE talk_scheduled SET status = 'sent', message_id = ? WHERE id = ?").run(result.row.id, r.id);
      await afterPost(actor, result);
      sent++;
    } catch (err) {
      const code = err instanceof Error ? err.message : 'send_failed';
      await db.prepare("UPDATE talk_scheduled SET status = 'failed', error = ? WHERE id = ?").run(code.slice(0, 100), r.id);
      failed++;
    }
  }
  return { sent, failed };
}

/** Todo lo de Talk del cron de cada minuto. */
export async function runTalkCron(): Promise<Record<string, unknown>> {
  const scheduled = await sendScheduledMessages().catch(() => null);
  const reminders = await fireTalkReminders().catch(() => null);
  const emails = await sendTalkEmails().catch(() => null);
  await getDb()
    .prepare('DELETE FROM talk_events WHERE created_at < ?')
    .run(new Date(Date.now() - 86_400_000).toISOString())
    .catch(() => undefined);
  // Lo que ya está escrito como evento de "escribiendo" no sirve después de unos segundos.
  await getDb()
    .prepare("DELETE FROM talk_events WHERE kind = 'typing' AND created_at < ?")
    .run(new Date(Date.now() - 10 * 60_000).toISOString())
    .catch(() => undefined);
  return { scheduled, reminders, emails, at: nowIso() };
}
