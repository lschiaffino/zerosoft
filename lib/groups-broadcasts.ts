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
import { PROVIDER_CAPS } from './groups-provider';
import { maskPhoneText } from './groups-mask';
import { normalizePoll, parsePoll, type PollInput } from './groups-polls';
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
  recurring_id?: string | null;
  poll?: string;
  reply_to_id?: string | null;
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
  /** Serie recurrente de la que salió esta corrida. */
  recurringId: string | null;
  poll: PollInput | null;
  /** Mensaje citado (solo un programado a un chat). */
  replyToId: string | null;
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
    recurringId: r.recurring_id ?? null,
    poll: parsePoll(r.poll),
    replyToId: r.reply_to_id ?? null,
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
  /** Encuesta en lugar de texto (solo números WAHA o Evolution). */
  poll?: unknown;
  /** Cita a un mensaje del chat. Solo para un programado a un único chat. */
  replyToId?: string | null;
}

export async function createBroadcast(ws: string, actor: string, input: CreateBroadcastInput): Promise<BroadcastDto> {
  let poll: PollInput | null = null;
  if (input.poll != null && input.poll !== '') {
    try {
      poll = normalizePoll(input.poll);
    } catch (err) {
      throw new GroupsError((err as Error).message);
    }
  }
  const body = poll ? poll.question : String(input.body ?? '').slice(0, 4096);
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
  if (poll && !PROVIDER_CAPS[number.provider].polls) throw new GroupsError('polls_unsupported');
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
  let replyToId: string | null = null;
  if (input.replyToId) {
    // La cita es de un chat: no tiene sentido en un envío a varios.
    if (kind !== 'scheduled' || mine.length !== 1 || poll) throw new GroupsError('invalid_reply');
    const target = await db.prepare('SELECT id FROM groups_messages WHERE id = ? AND user_id = ? AND chat_id = ?').get(input.replyToId, ws, mine[0].id);
    if (!target) throw new GroupsError('invalid_reply');
    replyToId = input.replyToId;
  }
  await db
    .prepare(
      `INSERT INTO groups_broadcasts (id, user_id, number_id, name, body, media_url, media_type, media_name, kind, status, scheduled_at,
         per_minute, total, created_by, created_at, poll, reply_to_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?)`,
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
      poll ? JSON.stringify(poll) : '',
      replyToId,
    );
  for (const c of mine) {
    await db.prepare('INSERT OR IGNORE INTO groups_broadcast_recipients (id, broadcast_id, chat_id) VALUES (?, ?, ?)').run(randomUUID(), id, c.id);
  }
  return toBroadcastDto((await getBroadcastRow(ws, id)) as BroadcastRow);
}

async function getBroadcastRow(ws: string, id: string): Promise<BroadcastRow | null> {
  return ((await getDb().prepare('SELECT * FROM groups_broadcasts WHERE id = ? AND user_id = ?').get(id, ws)) as BroadcastRow) ?? null;
}

/** Con `visible` (chats que ve la persona; null = todos), solo los envíos que van únicamente a chats que ve. */
export async function listBroadcasts(
  ws: string,
  opts: { kind?: 'broadcast' | 'scheduled'; chatId?: string; visible?: Set<string> | null } = {},
): Promise<BroadcastDto[]> {
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
  const visible = opts.visible;
  if (!visible || !rows.length) return rows.map(toBroadcastDto);
  const recipients = (await getDb()
    .prepare(`SELECT broadcast_id, chat_id FROM groups_broadcast_recipients WHERE broadcast_id IN (${rows.map(() => '?').join(', ')})`)
    .all(...rows.map((r) => r.id))) as Array<{ broadcast_id: string; chat_id: string }>;
  const hidden = new Set(recipients.filter((r) => !visible.has(r.chat_id)).map((r) => r.broadcast_id));
  return rows.filter((r) => !hidden.has(r.id)).map(toBroadcastDto);
}

/** Con `mask` (quien mira tiene los teléfonos ocultos), los chats sin nombre van enmascarados. */
export async function getBroadcast(ws: string, id: string, opts: { mask?: boolean } = {}): Promise<{ broadcast: BroadcastDto; recipients: RecipientDto[] } | null> {
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
      chatName: opts.mask && !r.name ? maskPhoneText(chatDisplayName(r)) : chatDisplayName(r),
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

/**
 * "Enviar ahora" de un programado: adelanta la hora a este momento. Quien
 * llama corre processBroadcasts después (o lo hace el cron del minuto).
 */
export async function sendBroadcastNow(ws: string, id: string): Promise<BroadcastDto> {
  const r = await getDb()
    .prepare("UPDATE groups_broadcasts SET scheduled_at = ? WHERE id = ? AND user_id = ? AND status = 'scheduled'")
    .run(nowIso(), id, ws);
  const row = await getBroadcastRow(ws, id);
  if (!row) throw new GroupsError('not_found', 404);
  if (r.changes === 0) throw new GroupsError('not_editable', 409);
  return toBroadcastDto(row);
}

/**
 * ¿Puede tocar este envío? Con acceso restringido (por etiqueta o por línea),
 * solo si ve todos los chats a los que va. `visible` null = ve todo.
 */
export async function canAccessBroadcast(ws: string, id: string, visible: Set<string> | null): Promise<boolean> {
  const db = getDb();
  const row = await db.prepare('SELECT id FROM groups_broadcasts WHERE id = ? AND user_id = ?').get(id, ws);
  if (!row) return false;
  if (!visible) return true;
  const rec = (await db.prepare('SELECT chat_id FROM groups_broadcast_recipients WHERE broadcast_id = ?').all(id)) as Array<{ chat_id: string }>;
  return rec.every((r) => visible.has(r.chat_id));
}

export interface ScheduledMessageDto extends BroadcastDto {
  /** El chat al que va (el pedido, o el primero si va a varios). */
  chat: { id: string; name: string; kind: 'dm' | 'group' };
  /** A cuántos chats más va (programado desde la selección múltiple). */
  otherChats: number;
  createdBy: string | null;
  mine: boolean;
}

/**
 * Mensajes programados que todavía no salieron, del más próximo al más
 * lejano: los de un chat (la tira de la conversación) o los de todo el
 * workspace (la vista "Programados"). `visible` filtra por acceso: un
 * programado que va a algún chat que la persona no ve no aparece.
 */
export async function listScheduledMessages(
  ws: string,
  me: string,
  opts: { chatId?: string; mine?: boolean; visible?: Set<string> | null; mask?: (c: { name: string; phone: string }) => { name: string; phone: string } } = {},
): Promise<ScheduledMessageDto[]> {
  const db = getDb();
  const where = ["b.user_id = ?", "b.kind = 'scheduled'", "b.status IN ('scheduled', 'sending')"];
  const args: string[] = [ws];
  if (opts.chatId) {
    where.push("EXISTS (SELECT 1 FROM groups_broadcast_recipients r WHERE r.broadcast_id = b.id AND r.chat_id = ? AND r.status IN ('pending', 'sending'))");
    args.push(opts.chatId);
  }
  if (opts.mine) {
    where.push('b.created_by = ?');
    args.push(me);
  }
  const rows = (await db
    .prepare(`SELECT b.* FROM groups_broadcasts b WHERE ${where.join(' AND ')} ORDER BY b.scheduled_at, b.created_at LIMIT 200`)
    .all(...args)) as BroadcastRow[];
  if (rows.length === 0) return [];
  const marks = rows.map(() => '?').join(',');
  const rec = (await db
    .prepare(
      `SELECT r.broadcast_id, r.chat_id, c.name, c.phone, c.provider_chat_id, c.kind FROM groups_broadcast_recipients r
       JOIN groups_chats c ON c.id = r.chat_id WHERE r.broadcast_id IN (${marks}) ORDER BY r.rowid`,
    )
    .all(...rows.map((r) => r.id))) as Array<{ broadcast_id: string; chat_id: string; name: string; phone: string; provider_chat_id: string; kind: 'dm' | 'group' }>;
  const byBroadcast = new Map<string, typeof rec>();
  for (const r of rec) byBroadcast.set(r.broadcast_id, [...(byBroadcast.get(r.broadcast_id) ?? []), r]);
  const out: ScheduledMessageDto[] = [];
  for (const row of rows) {
    const chats = byBroadcast.get(row.id) ?? [];
    if (chats.length === 0) continue;
    if (opts.visible && !chats.every((c) => opts.visible!.has(c.chat_id))) continue;
    const c = chats.find((x) => x.chat_id === opts.chatId) ?? chats[0];
    const shown = { name: chatDisplayName(c), phone: c.phone };
    out.push({
      ...toBroadcastDto(row),
      chat: { id: c.chat_id, name: (opts.mask ? opts.mask(shown) : shown).name, kind: c.kind },
      otherChats: chats.length - 1,
      createdBy: row.created_by,
      mine: row.created_by === me,
    });
  }
  return out;
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
            // Si el mensaje citado ya no está, sale sin la cita (mejor que no salir).
            const quoted = b.reply_to_id
              ? await db.prepare('SELECT id FROM groups_messages WHERE id = ? AND user_id = ? AND chat_id = ?').get(b.reply_to_id, b.user_id, chat.id)
              : null;
            const msg = await sendMessage(b.user_id, b.created_by, chat.id, {
              replyToId: quoted ? b.reply_to_id : null,
              poll: parsePoll(b.poll),
              body: text,
              media: b.media_type ? { url: b.media_url, mimetype: b.media_type, filename: b.media_name } : null,
              // Un programado a un chat es una respuesta; un envío masivo, no.
              authorKind: b.kind === 'scheduled' ? 'scheduled' : 'broadcast',
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
