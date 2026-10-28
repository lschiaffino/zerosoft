/**
 * Talk: ajustes del workspace (admins). Retención de mensajes (lo más viejo
 * que N días se borra en el cron de cada hora, con sus archivos y avisos),
 * ventana para editar mensajes y export de datos en JSON:
 *  - 'public': los canales públicos del workspace (como el export estándar
 *    de Slack), solo admins;
 *  - 'mine': lo que la persona lee como miembro (sus canales y sus DMs).
 * Server-only.
 */
import { getDb } from './db';
import { deleteUploads } from './uploads';
import { roleAtLeast } from './teams';
import {
  TalkError,
  listTalkPeople,
  nowIso,
  purgeMessageNotifications,
  type TalkActor,
  type TalkChannelKind,
} from './talk';

export const RETENTION_MIN_DAYS = 1;
export const RETENTION_MAX_DAYS = 3650;
export const EXPORT_MAX_MESSAGES = 50_000;

export interface TalkSettings {
  retentionDays: number | null;
  editWindowMinutes: number | null;
}

export async function getTalkSettings(workspaceId: string): Promise<TalkSettings> {
  const row = (await getDb().prepare('SELECT retention_days, edit_window_minutes FROM talk_settings WHERE workspace_id = ?').get(workspaceId)) as
    | { retention_days: number | null; edit_window_minutes: number | null }
    | undefined;
  return { retentionDays: row?.retention_days ?? null, editWindowMinutes: row?.edit_window_minutes ?? null };
}

export async function setTalkSettings(actor: TalkActor, input: Partial<TalkSettings>): Promise<TalkSettings> {
  if (actor.guest || !roleAtLeast(actor.role, 'admin')) throw new TalkError('forbidden', 403);
  const cur = await getTalkSettings(actor.workspaceId);
  const days = input.retentionDays === undefined ? cur.retentionDays : input.retentionDays;
  const edit = input.editWindowMinutes === undefined ? cur.editWindowMinutes : input.editWindowMinutes;
  if (days !== null && (!Number.isInteger(days) || days < RETENTION_MIN_DAYS || days > RETENTION_MAX_DAYS)) throw new TalkError('invalid_retention');
  if (edit !== null && (!Number.isInteger(edit) || edit < 1 || edit > 60 * 24 * 365)) throw new TalkError('invalid_input');
  await getDb()
    .prepare(
      `INSERT INTO talk_settings (workspace_id, retention_days, edit_window_minutes, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET retention_days = excluded.retention_days, edit_window_minutes = excluded.edit_window_minutes,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(actor.workspaceId, days, edit, actor.personId, nowIso());
  return { retentionDays: days, editWindowMinutes: edit };
}

/**
 * Cron: aplica la retención. Borra los mensajes de más de N días (y sus
 * archivos, avisos y recordatorios); un mensaje raíz con respuestas más
 * nuevas queda hasta que venzan. Por tandas: cada corrida borra a lo sumo
 * `limit` mensajes por workspace.
 */
export async function applyRetention(opts: { limit?: number; now?: Date } = {}): Promise<number> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 500;
  const settings = (await db.prepare('SELECT workspace_id, retention_days FROM talk_settings WHERE retention_days IS NOT NULL').all()) as Array<{ workspace_id: string; retention_days: number }>;
  let total = 0;
  for (const s of settings) {
    const cutoff = new Date(now.getTime() - Number(s.retention_days) * 86_400_000).toISOString();
    const rows = (await db
      .prepare(
        `SELECT id, parent_id FROM talk_messages WHERE workspace_id = ? AND created_at < ?
           AND (parent_id IS NOT NULL OR last_reply_at IS NULL OR last_reply_at < ?) LIMIT ?`,
      )
      .all(s.workspace_id, cutoff, cutoff, limit)) as Array<{ id: string; parent_id: string | null }>;
    if (!rows.length) continue;
    const ids = rows.map((r) => r.id);
    const marks = ids.map(() => '?').join(', ');
    const files = (await db.prepare(`SELECT url FROM talk_files WHERE message_id IN (${marks})`).all(...ids)) as Array<{ url: string }>;
    await purgeMessageNotifications(ids);
    await db.prepare(`DELETE FROM talk_files WHERE message_id IN (${marks})`).run(...ids);
    await db.prepare(`DELETE FROM talk_messages WHERE id IN (${marks})`).run(...ids);
    // Los hilos que perdieron respuestas recalculan su contador.
    for (const parent of new Set(rows.map((r) => r.parent_id).filter((p): p is string => !!p))) {
      await db
        .prepare('UPDATE talk_messages SET reply_count = (SELECT COUNT(*) FROM talk_messages r WHERE r.parent_id = ?) WHERE id = ?')
        .run(parent, parent);
    }
    await deleteUploads(files.map((f) => f.url)).catch(() => undefined);
    total += ids.length;
  }
  return total;
}

export interface ExportedChannel {
  id: string;
  name: string;
  kind: TalkChannelKind;
  topic: string;
  description: string;
  created_at: string;
  archived_at: string | null;
  members: string[];
  messages: Array<{ id: string; ts: string; thread_id: string | null; user_id: string | null; user_name: string | null; bot_name: string | null; text: string; edited_at: string | null; files: string[] }>;
}

export interface TalkExport {
  exported_at: string;
  scope: 'public' | 'mine';
  workspace_id: string;
  users: Array<{ id: string; name: string; email: string; guest: boolean }>;
  channels: ExportedChannel[];
  truncated: boolean;
}

export async function exportTalk(actor: TalkActor, scope: 'public' | 'mine'): Promise<TalkExport> {
  if (scope === 'public' && (actor.guest || !roleAtLeast(actor.role, 'admin'))) throw new TalkError('forbidden', 403);
  const db = getDb();
  const channels = (await db
    .prepare(
      scope === 'public'
        ? "SELECT * FROM talk_channels WHERE workspace_id = ? AND kind = 'public' ORDER BY name"
        : 'SELECT c.* FROM talk_channels c JOIN talk_members m ON m.channel_id = c.id AND m.user_id = ? WHERE c.workspace_id = ? ORDER BY c.kind, c.name',
    )
    .all(...(scope === 'public' ? [actor.workspaceId] : [actor.personId, actor.workspaceId]))) as Array<{
    id: string;
    name: string;
    kind: TalkChannelKind;
    topic: string;
    description: string;
    created_at: string;
    archived_at: string | null;
  }>;
  const people = await listTalkPeople(actor.workspaceId);
  const names = new Map(people.map((p) => [p.id, p.name]));
  let count = 0;
  let truncated = false;
  const out: ExportedChannel[] = [];
  const userIds = new Set<string>();
  for (const c of channels) {
    const members = ((await db.prepare('SELECT user_id FROM talk_members WHERE channel_id = ?').all(c.id)) as Array<{ user_id: string }>).map((m) => m.user_id);
    members.forEach((m) => userIds.add(m));
    const room = EXPORT_MAX_MESSAGES - count;
    if (room <= 0) {
      truncated = true;
      break;
    }
    const msgs = (await db
      .prepare('SELECT id, created_at, parent_id, user_id, bot_name, body, edited_at FROM talk_messages WHERE channel_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT ?')
      .all(c.id, room + 1)) as Array<{ id: string; created_at: string; parent_id: string | null; user_id: string | null; bot_name: string | null; body: string; edited_at: string | null }>;
    if (msgs.length > room) truncated = true;
    const kept = msgs.slice(0, room);
    const files = kept.length
      ? ((await db.prepare('SELECT message_id, name FROM talk_files WHERE channel_id = ? AND message_id IS NOT NULL').all(c.id)) as Array<{ message_id: string; name: string }>)
      : [];
    out.push({
      ...c,
      members,
      messages: kept.map((m) => {
        if (m.user_id) userIds.add(m.user_id);
        return {
          id: m.id,
          ts: m.created_at,
          thread_id: m.parent_id,
          user_id: m.user_id,
          user_name: m.user_id ? (names.get(m.user_id) ?? null) : null,
          bot_name: m.bot_name,
          text: m.body,
          edited_at: m.edited_at,
          files: files.filter((f) => f.message_id === m.id).map((f) => f.name),
        };
      }),
    });
    count += kept.length;
  }
  return {
    exported_at: nowIso(),
    scope,
    workspace_id: actor.workspaceId,
    users: people.filter((p) => userIds.has(p.id)).map((p) => ({ id: p.id, name: p.name, email: p.email, guest: !!p.guest })),
    channels: out,
    truncated,
  };
}
