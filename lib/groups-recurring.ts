/**
 * Groups: mensajes recurrentes. Una serie tiene número de salida, chats o
 * grupos destino, texto (con variables) o encuesta, una regla
 * (lib/groups-recurrence.ts), zona horaria, fecha de fin opcional y ritmo.
 *
 * El cron de cada minuto reclama las series vencidas (locked_until y
 * next_run_at, compare-and-set) y por cada corrida crea un envío
 * (groups_broadcasts con recurring_id) que sale con el mismo ritmo y tope por
 * número que los envíos masivos. Así cada corrida tiene su estado en vivo por
 * destinatario. Server-only.
 */
import { randomUUID } from 'crypto';
import { getDb } from './db';
import { GroupsError, getNumberRow } from './groups';
import { clampPerMinute } from './groups-rules';
import { normalizePoll, parsePoll, type PollInput } from './groups-polls';
import { isValidTimezone, nextRun, normalizeRule, upcomingRuns, type RecurrenceRule } from './groups-recurrence';

const nowIso = () => new Date().toISOString();

export interface RecurringRow {
  id: string;
  user_id: string;
  number_id: string;
  name: string;
  body: string;
  media_url: string;
  media_type: string;
  media_name: string;
  poll: string;
  chat_ids: string;
  rule: string;
  timezone: string;
  per_minute: number;
  status: 'active' | 'paused' | 'ended';
  next_run_at: string | null;
  last_run_at: string | null;
  runs: number;
  ends_at: string | null;
  locked_until: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecurringDto {
  id: string;
  numberId: string;
  name: string;
  body: string;
  media: { url: string; type: string; name: string } | null;
  poll: PollInput | null;
  chatIds: string[];
  rule: RecurrenceRule;
  timezone: string;
  perMinute: number;
  status: RecurringRow['status'];
  nextRunAt: string | null;
  upcoming: string[];
  lastRunAt: string | null;
  runs: number;
  endsAt: string | null;
  createdAt: string;
}

function parseIds(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function toRecurringDto(r: RecurringRow): RecurringDto {
  let rule: RecurrenceRule;
  try {
    rule = normalizeRule(JSON.parse(r.rule));
  } catch {
    rule = { freq: 'daily', time: '09:00', days: [], dayOfMonth: 1, cron: '' };
  }
  return {
    id: r.id,
    numberId: r.number_id,
    name: r.name,
    body: r.body,
    media: r.media_type ? { url: r.media_url, type: r.media_type, name: r.media_name } : null,
    poll: parsePoll(r.poll),
    chatIds: parseIds(r.chat_ids),
    rule,
    timezone: r.timezone,
    perMinute: r.per_minute,
    status: r.status,
    nextRunAt: r.status === 'active' ? r.next_run_at : null,
    upcoming: r.status === 'active' && r.next_run_at ? upcomingRuns(rule, r.timezone, new Date(Date.parse(r.next_run_at) - 1), 3, r.ends_at).map((d) => d.toISOString()) : [],
    lastRunAt: r.last_run_at,
    runs: r.runs,
    endsAt: r.ends_at,
    createdAt: r.created_at,
  };
}

export interface RecurringInput {
  numberId?: string;
  name?: string;
  body?: string;
  media?: { url: string; mimetype: string; filename: string } | null;
  poll?: unknown;
  chatIds?: string[];
  rule?: unknown;
  timezone?: string;
  perMinute?: number;
  endsAt?: string | null;
}

async function cleanTargets(ws: string, chatIds: string[], numberId?: string): Promise<{ numberId: string; chatIds: string[] }> {
  const ids = [...new Set(chatIds)].slice(0, 2000);
  if (ids.length === 0) throw new GroupsError('no_recipients');
  const marks = ids.map(() => '?').join(',');
  const chats = (await getDb()
    .prepare(`SELECT id, number_id FROM groups_chats WHERE user_id = ? AND id IN (${marks})`)
    .all(ws, ...ids)) as Array<{ id: string; number_id: string }>;
  if (chats.length === 0) throw new GroupsError('no_recipients');
  const number = numberId || chats[0].number_id;
  if (!(await getNumberRow(ws, number))) throw new GroupsError('invalid_number');
  const mine = chats.filter((c) => c.number_id === number).map((c) => c.id);
  if (mine.length === 0) throw new GroupsError('no_recipients');
  return { numberId: number, chatIds: mine };
}

function cleanPoll(raw: unknown): PollInput | null {
  if (raw == null || raw === '') return null;
  try {
    return normalizePoll(raw);
  } catch (err) {
    throw new GroupsError((err as Error).message);
  }
}

function cleanRule(raw: unknown): RecurrenceRule {
  try {
    return normalizeRule(raw);
  } catch (err) {
    throw new GroupsError((err as Error).message);
  }
}

function cleanEnds(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) throw new GroupsError('invalid_date');
  return new Date(t).toISOString();
}

export async function createRecurring(ws: string, actor: string, input: RecurringInput): Promise<RecurringDto> {
  const poll = cleanPoll(input.poll);
  const body = String(input.body ?? '').slice(0, 4096);
  if (!poll && !body.trim() && !input.media) throw new GroupsError('empty_message');
  const rule = cleanRule(input.rule);
  const timezone = input.timezone && isValidTimezone(input.timezone) ? input.timezone : 'UTC';
  const target = await cleanTargets(ws, input.chatIds ?? [], input.numberId);
  if (poll) {
    const number = await getNumberRow(ws, target.numberId);
    const { PROVIDER_CAPS } = await import('./groups-provider');
    if (!number || !PROVIDER_CAPS[number.provider].polls) throw new GroupsError('polls_unsupported');
  }
  const endsAt = cleanEnds(input.endsAt);
  const next = nextRun(rule, timezone, new Date());
  if (!next || (endsAt && next.getTime() > Date.parse(endsAt))) throw new GroupsError('no_next_run');
  const id = randomUUID();
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO groups_recurring (id, user_id, number_id, name, body, media_url, media_type, media_name, poll, chat_ids, rule, timezone,
         per_minute, status, next_run_at, ends_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      ws,
      target.numberId,
      String(input.name ?? '').trim().slice(0, 120),
      poll ? poll.question : body,
      input.media?.url ?? '',
      input.media?.mimetype ?? '',
      input.media?.filename ?? '',
      poll ? JSON.stringify(poll) : '',
      JSON.stringify(target.chatIds),
      JSON.stringify(rule),
      timezone,
      clampPerMinute(input.perMinute ?? 20),
      next.toISOString(),
      endsAt,
      actor,
      now,
      now,
    );
  return toRecurringDto((await getRecurringRow(ws, id)) as RecurringRow);
}

export async function getRecurringRow(ws: string, id: string): Promise<RecurringRow | null> {
  return ((await getDb().prepare('SELECT * FROM groups_recurring WHERE id = ? AND user_id = ?').get(id, ws)) as RecurringRow) ?? null;
}

export async function getRecurring(ws: string, id: string): Promise<RecurringDto | null> {
  const r = await getRecurringRow(ws, id);
  return r ? toRecurringDto(r) : null;
}

export async function listRecurring(ws: string, opts: { chatId?: string } = {}): Promise<RecurringDto[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM groups_recurring WHERE user_id = ? ORDER BY created_at DESC LIMIT 200')
    .all(ws)) as RecurringRow[];
  return rows.map(toRecurringDto).filter((r) => !opts.chatId || r.chatIds.includes(opts.chatId));
}

export interface RecurringPatch extends RecurringInput {
  status?: 'active' | 'paused';
}

/** Editar, pausar o reanudar. Al reanudar o cambiar la regla se recalcula la próxima corrida. */
export async function updateRecurring(ws: string, id: string, patch: RecurringPatch): Promise<RecurringDto> {
  const row = await getRecurringRow(ws, id);
  if (!row) throw new GroupsError('not_found', 404);
  const cur = toRecurringDto(row);
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  const set = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };
  if (patch.name !== undefined) set('name', String(patch.name).trim().slice(0, 120));
  const poll = patch.poll !== undefined ? cleanPoll(patch.poll) : cur.poll;
  if (patch.poll !== undefined) set('poll', poll ? JSON.stringify(poll) : '');
  if (patch.body !== undefined || patch.poll !== undefined) {
    const body = poll ? poll.question : String(patch.body ?? cur.body).slice(0, 4096);
    if (!poll && !body.trim() && !cur.media) throw new GroupsError('empty_message');
    set('body', body);
  }
  if (patch.chatIds !== undefined) {
    const target = await cleanTargets(ws, patch.chatIds, row.number_id);
    set('chat_ids', JSON.stringify(target.chatIds));
  }
  if (patch.perMinute !== undefined) set('per_minute', clampPerMinute(patch.perMinute));
  const rule = patch.rule !== undefined ? cleanRule(patch.rule) : cur.rule;
  if (patch.rule !== undefined) set('rule', JSON.stringify(rule));
  const timezone = patch.timezone !== undefined ? (isValidTimezone(patch.timezone) ? patch.timezone : 'UTC') : row.timezone;
  if (patch.timezone !== undefined) set('timezone', timezone);
  const endsAt = patch.endsAt !== undefined ? cleanEnds(patch.endsAt) : row.ends_at;
  if (patch.endsAt !== undefined) set('ends_at', endsAt);
  let status: RecurringRow['status'] = row.status;
  if (patch.status === 'paused' || patch.status === 'active') status = patch.status;
  if (status === 'active' && (patch.status === 'active' || patch.rule !== undefined || patch.timezone !== undefined || patch.endsAt !== undefined || row.status !== 'active')) {
    const next = nextRun(rule, timezone, new Date());
    if (!next || (endsAt && next.getTime() > Date.parse(endsAt))) throw new GroupsError('no_next_run');
    set('next_run_at', next.toISOString());
  }
  set('status', status);
  await getDb()
    .prepare(`UPDATE groups_recurring SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(...args, nowIso(), id, ws);
  return toRecurringDto((await getRecurringRow(ws, id)) as RecurringRow);
}

export async function deleteRecurring(ws: string, id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM groups_recurring WHERE id = ? AND user_id = ?').run(id, ws)).changes > 0;
}

/** Corridas anteriores de la serie (envíos con su progreso). */
export async function recurringRuns(ws: string, id: string): Promise<Array<{ id: string; status: string; total: number; sent: number; failed: number; scheduledAt: string }>> {
  const rows = (await getDb()
    .prepare(
      'SELECT id, status, total, sent, failed, scheduled_at FROM groups_broadcasts WHERE user_id = ? AND recurring_id = ? ORDER BY scheduled_at DESC LIMIT 50',
    )
    .all(ws, id)) as Array<{ id: string; status: string; total: number; sent: number; failed: number; scheduled_at: string }>;
  return rows.map((r) => ({ id: r.id, status: r.status, total: r.total, sent: r.sent, failed: r.failed, scheduledAt: r.scheduled_at }));
}

/**
 * Corre las series vencidas: por cada una reclama la corrida (CAS sobre
 * next_run_at y locked_until), crea el envío y calcula la próxima. Devuelve
 * cuántas corridas creó. Los envíos salen después con processBroadcasts.
 */
export async function runDueRecurring(now = new Date(), limit = 50): Promise<number> {
  const db = getDb();
  const at = now.toISOString();
  const due = (await db
    .prepare(
      `SELECT * FROM groups_recurring WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?
       AND (locked_until IS NULL OR locked_until < ?) ORDER BY next_run_at LIMIT ?`,
    )
    .all(at, at, limit)) as RecurringRow[];
  let created = 0;
  for (const r of due) {
    const dto = toRecurringDto(r);
    const next = nextRun(dto.rule, r.timezone, new Date(Math.max(now.getTime(), Date.parse(r.next_run_at as string))));
    const ended = !next || (r.ends_at && next.getTime() > Date.parse(r.ends_at));
    // Claim: la corrida es de quien mueve next_run_at primero.
    const claim = await db
      .prepare(
        `UPDATE groups_recurring SET next_run_at = ?, status = ?, last_run_at = ?, runs = runs + 1, updated_at = ?
         WHERE id = ? AND status = 'active' AND next_run_at = ? AND (locked_until IS NULL OR locked_until < ?)`,
      )
      .run(ended ? null : (next as Date).toISOString(), ended ? 'ended' : 'active', at, at, r.id, r.next_run_at, at);
    if (claim.changes === 0) continue;
    // Una corrida vencida hace más de un día (servidor apagado) no se manda tarde: solo se reprograma.
    if (now.getTime() - Date.parse(r.next_run_at as string) > 86_400_000) continue;
    try {
      const chatIds = dto.chatIds;
      const marks = chatIds.map(() => '?').join(',') || "''";
      const alive = (await db
        .prepare(`SELECT id FROM groups_chats WHERE user_id = ? AND number_id = ? AND id IN (${marks})`)
        .all(r.user_id, r.number_id, ...chatIds)) as Array<{ id: string }>;
      if (alive.length === 0) continue;
      const id = randomUUID();
      await db
        .prepare(
          `INSERT INTO groups_broadcasts (id, user_id, number_id, name, body, media_url, media_type, media_name, kind, status, scheduled_at,
             per_minute, total, created_by, created_at, recurring_id, poll)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          r.user_id,
          r.number_id,
          r.name,
          r.body,
          r.media_url,
          r.media_type,
          r.media_name,
          alive.length === 1 ? 'scheduled' : 'broadcast',
          at,
          r.per_minute,
          alive.length,
          r.created_by,
          at,
          r.id,
          r.poll,
        );
      for (const c of alive) {
        await db.prepare('INSERT OR IGNORE INTO groups_broadcast_recipients (id, broadcast_id, chat_id) VALUES (?, ?, ?)').run(randomUUID(), id, c.id);
      }
      created++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[groups] recurring run failed', (err as Error)?.name ?? 'error');
    }
  }
  return created;
}
