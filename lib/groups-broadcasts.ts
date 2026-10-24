/**
 * Groups: envíos masivos y mensajes programados. Un envío tiene un número de
 * salida, un texto con variables ({{name}}, {{prop.<clave>}}), una hora y un
 * ritmo (mensajes por minuto). Cada destinatario guarda su estado.
 *
 * El cron de cada minuto los avanza: reclama el envío (locked_until, CAS) y
 * cada destinatario (status pending → sending, CAS) antes de mandar, así dos
 * corridas no mandan dos veces. El ritmo usa ventana deslizante de 60 s por
 * envío y un tope por número (lib/groups-rules.ts). Server-only.
 */
import { randomUUID } from 'crypto';
import { getDb } from './db';
import { GroupsError, chatDisplayName, getNumberRow, sendMessage, type ChatRow } from './groups';
import { allowedSends, chatVariables, clampPerMinute, renderVariables, sendGapMs } from './groups-rules';

const nowIso = () => new Date().toISOString();

export interface BroadcastRow {
  id: string;
  user_id: string;
  number_id: string;
  name: string;
  body: string;
  media_url: string;
  media_type: string;
  media_name: string;
  kind: 'broadcast' | 'scheduled';
  status: 'scheduled' | 'sending' | 'done' | 'cancelled';
  scheduled_at: string;
  per_minute: number;
  total: number;
  sent: number;
  failed: number;
  locked_until: string | null;
  created_by: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface BroadcastDto {
  id: string;
  numberId: string;
  name: string;
  body: string;
  media: { url: string; type: string; name: string } | null;
  kind: BroadcastRow['kind'];
  status: BroadcastRow['status'];
  scheduledAt: string;
  perMinute: number;
  total: number;
  sent: number;
  failed: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface RecipientDto {
  id: string;
  chatId: string;
  chatName: string;
  kind: 'dm' | 'group';
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
  error: string;
  sentAt: string | null;
}

export function toBroadcastDto(r: BroadcastRow): BroadcastDto {
  return {
    id: r.id,
    numberId: r.number_id,
    name: r.name,
    body: r.body,
    media: r.media_type ? { url: r.media_url, type: r.media_type, name: r.media_name } : null,
    kind: r.kind,
    status: r.status,
    scheduledAt: r.scheduled_at,
    perMinute: r.per_minute,
    total: r.total,
    sent: r.sent,
    failed: r.failed,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  };
}

export const MAX_RECIPIENTS = 2000;

export interface CreateBroadcastInput {
  numberId?: string;
  name?: string;
  body: string;
  media?: { url: string; mimetype: string; filename: string } | null;
  chatIds: string[];
  scheduledAt?: string | null;
  perMinute?: number;
  kind?: 'broadcast' | 'scheduled';
}

export async function createBroadcast(ws: string, actor: string, input: CreateBroadcastInput): Promise<BroadcastDto> {
  const body = String(input.body ?? '').slice(0, 4096);
  if (!body.trim() && !input.media) throw new GroupsError('empty_message');
  const chatIds = [...new Set(input.chatIds ?? [])];
  if (chatIds.length === 0) throw new GroupsError('no_recipients');
  if (chatIds.length > MAX_RECIPIENTS) throw new GroupsError('too_many_recipients');
  const db = getDb();
  const marks = chatIds.map(() => '?').join(',');
  const chats = (await db
    .prepare(`SELECT id, number_id FROM groups_chats WHERE user_id = ? AND id IN (${marks})`)
    .all(ws, ...chatIds)) as Array<{ id: string; number_id: string }>;
  if (chats.length === 0) throw new GroupsError('no_recipients');
  // Un envío sale de un número: los chats de otros números quedan afuera.
  const numberId = input.numberId || chats[0].number_id;
  const number = await getNumberRow(ws, numberId);
  if (!number) throw new GroupsError('invalid_number');
  const mine = chats.filter((c) => c.number_id === numberId);
  if (mine.length === 0) throw new GroupsError('no_recipients');
  let scheduled = new Date();
  if (input.scheduledAt) {
    const t = Date.parse(input.scheduledAt);
    if (!Number.isFinite(t)) throw new GroupsError('invalid_date');
    if (t > Date.now() + 366 * 86_400_000) throw new GroupsError('invalid_date');
    scheduled = new Date(Math.max(t, Date.now()));
  }
  const id = randomUUID();
  const now = nowIso();
  const kind = input.kind === 'scheduled' ? 'scheduled' : 'broadcast';
  await db
    .prepare(
      `INSERT INTO groups_broadcasts (id, user_id, number_id, name, body, media_url, media_type, media_name, kind, status, scheduled_at,
         per_minute, total, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      ws,
      numberId,
      String(input.name ?? '').trim().slice(0, 120),
      body,
      input.media?.url ?? '',
      input.media?.mimetype ?? '',
      input.media?.filename ?? '',
      kind,
      scheduled.toISOString(),
      clampPerMinute(input.perMinute ?? 20),
      mine.length,
      actor,
      now,
    );
  for (const c of mine) {
    await db.prepare('INSERT OR IGNORE INTO groups_broadcast_recipients (id, broadcast_id, chat_id) VALUES (?, ?, ?)').run(randomUUID(), id, c.id);
  }
  return toBroadcastDto((await getBroadcastRow(ws, id)) as BroadcastRow);
}

async function getBroadcastRow(ws: string, id: string): Promise<BroadcastRow | null> {
  return ((await getDb().prepare('SELECT * FROM groups_broadcasts WHERE id = ? AND user_id = ?').get(id, ws)) as BroadcastRow) ?? null;
}

export async function listBroadcasts(ws: string, opts: { kind?: 'broadcast' | 'scheduled'; chatId?: string } = {}): Promise<BroadcastDto[]> {
  const where = ['b.user_id = ?'];
  const args: string[] = [ws];
  if (opts.kind) {
    where.push('b.kind = ?');
    args.push(opts.kind);
  }
  if (opts.chatId) {
    where.push('EXISTS (SELECT 1 FROM groups_broadcast_recipients r WHERE r.broadcast_id = b.id AND r.chat_id = ?)');
    args.push(opts.chatId);
  }
  const rows = (await getDb()
    .prepare(`SELECT b.* FROM groups_broadcasts b WHERE ${where.join(' AND ')} ORDER BY b.created_at DESC LIMIT 200`)
    .all(...args)) as BroadcastRow[];
  return rows.map(toBroadcastDto);
}

export async function getBroadcast(ws: string, id: string): Promise<{ broadcast: BroadcastDto; recipients: RecipientDto[] } | null> {
  const row = await getBroadcastRow(ws, id);
  if (!row) return null;
  const rec = (await getDb()
    .prepare(
      `SELECT r.*, c.name, c.phone, c.provider_chat_id, c.kind FROM groups_broadcast_recipients r JOIN groups_chats c ON c.id = r.chat_id
       WHERE r.broadcast_id = ? ORDER BY CASE r.status WHEN 'failed' THEN 0 WHEN 'sending' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END, c.name`,
    )
    .all(id)) as Array<{
    id: string;
    chat_id: string;
    status: RecipientDto['status'];
    error: string;
    sent_at: string | null;
    name: string;
    phone: string;
    provider_chat_id: string;
    kind: 'dm' | 'group';
  }>;
  return {
    broadcast: toBroadcastDto(row),
    recipients: rec.map((r) => ({
      id: r.id,
      chatId: r.chat_id,
      chatName: chatDisplayName(r),
      kind: r.kind,
      status: r.status,
      error: r.error,
      sentAt: r.sent_at,
    })),
  };
}

export async function updateBroadcast(
  ws: string,
  id: string,
  patch: { name?: string; body?: string; scheduledAt?: string; perMinute?: number },
): Promise<BroadcastDto> {
  const row = await getBroadcastRow(ws, id);
  if (!row) throw new GroupsError('not_found', 404);
  if (row.status !== 'scheduled') throw new GroupsError('not_editable', 409);
  const sets: string[] = [];
  const args: Array<string | number> = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    args.push(patch.name.trim().slice(0, 120));
  }
  if (patch.body !== undefined) {
    if (!patch.body.trim() && !row.media_type) throw new GroupsError('empty_message');
    sets.push('body = ?');
    args.push(patch.body.slice(0, 4096));
  }
  if (patch.scheduledAt !== undefined) {
    const t = Date.parse(patch.scheduledAt);
    if (!Number.isFinite(t)) throw new GroupsError('invalid_date');
    sets.push('scheduled_at = ?');
    args.push(new Date(Math.max(t, Date.now())).toISOString());
  }
  if (patch.perMinute !== undefined) {
    sets.push('per_minute = ?');
    args.push(clampPerMinute(patch.perMinute));
  }
  if (sets.length) {
    // Solo mientras sigue programado (el cron puede haberlo tomado).
    const r = await getDb()
      .prepare(`UPDATE groups_broadcasts SET ${sets.join(', ')} WHERE id = ? AND user_id = ? AND status = 'scheduled'`)
      .run(...args, id, ws);
    if (r.changes === 0) throw new GroupsError('not_editable', 409);
  }
  return toBroadcastDto((await getBroadcastRow(ws, id)) as BroadcastRow);
}

/** Cancela lo que falta mandar (lo ya enviado queda). */
export async function cancelBroadcast(ws: string, id: string): Promise<BroadcastDto> {
  const db = getDb();
  const r = await db
    .prepare("UPDATE groups_broadcasts SET status = 'cancelled', finished_at = ? WHERE id = ? AND user_id = ? AND status IN ('scheduled', 'sending')")
    .run(nowIso(), id, ws);
  if (r.changes === 0) {
    const row = await getBroadcastRow(ws, id);
    if (!row) throw new GroupsError('not_found', 404);
    return toBroadcastDto(row);
  }
  await db.prepare("UPDATE groups_broadcast_recipients SET status = 'skipped' WHERE broadcast_id = ? AND status = 'pending'").run(id);
  return toBroadcastDto((await getBroadcastRow(ws, id)) as BroadcastRow);
}

export async function deleteBroadcast(ws: string, id: string): Promise<boolean> {
  return (await getDb().prepare("DELETE FROM groups_broadcasts WHERE id = ? AND user_id = ? AND status != 'sending'").run(id, ws)).changes > 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function recentSends(sql: string, arg: string, since: string): Promise<number[]> {
  const rows = (await getDb().prepare(sql).all(arg, since)) as Array<{ sent_at: string }>;
  return rows.map((r) => Date.parse(r.sent_at)).filter(Number.isFinite);
}

export interface ProcessResult {
  broadcasts: number;
  sent: number;
  failed: number;
}

/**
 * Avanza los envíos vencidos. `gap` permite a los tests no esperar entre
 * mensajes. Cada envío se reclama 2 minutos (locked_until).
 */
export async function processBroadcasts(
  opts: { now?: Date; budgetMs?: number; limit?: number; gapMs?: number; broadcastId?: string } = {},
): Promise<ProcessResult> {
  const db = getDb();
  const start = Date.now();
  const budget = opts.budgetMs ?? 40_000;
  const out: ProcessResult = { broadcasts: 0, sent: 0, failed: 0 };
  const nowIsoStr = (opts.now ?? new Date()).toISOString();
  const due = (await db
    .prepare(
      `SELECT * FROM groups_broadcasts WHERE status IN ('scheduled', 'sending') AND scheduled_at <= ?
       AND (locked_until IS NULL OR locked_until < ?) ${opts.broadcastId ? 'AND id = ?' : ''}
       ORDER BY scheduled_at LIMIT ?`,
    )
    .all(nowIsoStr, nowIsoStr, ...(opts.broadcastId ? [opts.broadcastId] : []), opts.limit ?? 20)) as BroadcastRow[];

  for (const b of due) {
    if (Date.now() - start > budget) break;
    const lockUntil = new Date(Date.now() + 120_000).toISOString();
    const claim = await db
      .prepare(
        `UPDATE groups_broadcasts SET locked_until = ?, status = 'sending' WHERE id = ? AND status IN ('scheduled', 'sending')
         AND (locked_until IS NULL OR locked_until < ?)`,
      )
      .run(lockUntil, b.id, new Date().toISOString());
    if (claim.changes === 0) continue;
    out.broadcasts++;
    try {
      const since = new Date(Date.now() - 60_000).toISOString();
      const own = await recentSends(
        "SELECT sent_at FROM groups_broadcast_recipients WHERE broadcast_id = ? AND status IN ('sent', 'failed') AND sent_at > ?",
        b.id,
        since,
      );
      const byNumber = await recentSends(
        `SELECT r.sent_at FROM groups_broadcast_recipients r JOIN groups_broadcasts x ON x.id = r.broadcast_id
         WHERE x.number_id = ? AND r.status IN ('sent', 'failed') AND r.sent_at > ?`,
        b.number_id,
        since,
      );
      const allowed = allowedSends({ perMinute: b.per_minute, broadcastSentAt: own, numberSentAt: byNumber, now: Date.now() });
      const pending = (await db
        .prepare(
          `SELECT r.id, r.chat_id FROM groups_broadcast_recipients r WHERE r.broadcast_id = ? AND r.status = 'pending' ORDER BY r.rowid LIMIT ?`,
        )
        .all(b.id, allowed)) as Array<{ id: string; chat_id: string }>;
      const gap = opts.gapMs ?? sendGapMs(b.per_minute);
      for (const [i, rec] of pending.entries()) {
        if (Date.now() - start > budget) break;
        const got = await db
          .prepare("UPDATE groups_broadcast_recipients SET status = 'sending' WHERE id = ? AND status = 'pending'")
          .run(rec.id);
        if (got.changes === 0) continue;
        // Cancelado mientras mandábamos: el resto queda sin mandar.
        const still = (await db.prepare('SELECT status FROM groups_broadcasts WHERE id = ?').get(b.id)) as { status: string } | undefined;
        if (still?.status === 'cancelled') {
          await db.prepare("UPDATE groups_broadcast_recipients SET status = 'skipped' WHERE id = ?").run(rec.id);
          break;
        }
        if (i > 0 && gap > 0) await sleep(gap);
        const chat = (await db.prepare('SELECT * FROM groups_chats WHERE id = ?').get(rec.chat_id)) as ChatRow | undefined;
        let status: 'sent' | 'failed' | 'skipped' = 'failed';
        let error = '';
        let messageId: string | null = null;
        if (!chat) {
          status = 'skipped';
          error = 'chat_deleted';
        } else {
          const text = renderVariables(b.body, chatVariables({ name: chatDisplayName(chat), phone: chat.phone, properties: JSON.parse(chat.properties || '{}') }));
          try {
            const msg = await sendMessage(b.user_id, b.created_by, chat.id, {
              body: text,
              media: b.media_type ? { url: b.media_url, mimetype: b.media_type, filename: b.media_name } : null,
              authorKind: 'broadcast',
            });
            messageId = msg.id;
            status = msg.status === 'failed' ? 'failed' : 'sent';
            error = msg.error;
          } catch (err) {
            error = (err as { code?: string })?.code ?? 'send_failed';
          }
        }
        await db
          .prepare('UPDATE groups_broadcast_recipients SET status = ?, error = ?, message_id = ?, sent_at = ? WHERE id = ?')
          .run(status, error, messageId, new Date().toISOString(), rec.id);
        if (status === 'sent') out.sent++;
        else if (status === 'failed') out.failed++;
      }
      await finishIfDone(b.id);
    } finally {
      await db.prepare('UPDATE groups_broadcasts SET locked_until = NULL WHERE id = ? AND locked_until = ?').run(b.id, lockUntil);
    }
  }
  return out;
}

async function finishIfDone(id: string): Promise<void> {
  const db = getDb();
  const c = (await db
    .prepare(
      `SELECT SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed, SUM(status IN ('pending', 'sending')) AS left
       FROM groups_broadcast_recipients WHERE broadcast_id = ?`,
    )
    .get(id)) as { sent: number | null; failed: number | null; left: number | null };
  await db.prepare('UPDATE groups_broadcasts SET sent = ?, failed = ? WHERE id = ?').run(Number(c.sent ?? 0), Number(c.failed ?? 0), id);
  if (Number(c.left ?? 0) === 0) {
    await db.prepare("UPDATE groups_broadcasts SET status = 'done', finished_at = ? WHERE id = ? AND status = 'sending'").run(nowIso(), id);
  }
}
