/**
 * Session replay, la parte con base: guardar chunks con sus topes, listar y
 * leer grabaciones, borrarlas y la retención del cron. Server-only.
 */
import { createHash } from 'crypto';
import { promisify } from 'util';
import { gzip } from 'zlib';
import { getClient, getDb } from '../db';
import { likeContains } from '../track-views';
import { mergePages, recordingRetentionDays, REPLAY_LIMITS, type ChunkSummary, type ReplayChunk } from './replay-core';
import { toLiveEvent } from './query';
import { personLabel, type LiveEvent } from './types';
import type { Arg } from './sql-build';
import type { ProjectRow } from './projects';

const gzipAsync = promisify(gzip);
const DAY = 86_400_000;
type Row = Record<string, unknown>;

export interface RecordingDto {
  id: string;
  sessionId: string;
  windowId: string;
  distinctId: string;
  personId: string | null;
  person: string;
  startTs: number;
  endTs: number;
  durationMs: number;
  activeSeconds: number;
  clicks: number;
  firstUrl: string | null;
  pages: string[];
  chunks: number;
  bytes: number;
}

function parseList(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function parseProps(raw: unknown): Record<string, unknown> {
  try {
    const v = JSON.parse(String(raw ?? '{}'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function toDto(r: Row): RecordingDto {
  const durationMs = Math.max(0, Number(r.end_ts) - Number(r.start_ts));
  const distinctId = String(r.distinct_id);
  return {
    id: String(r.id),
    sessionId: String(r.session_id),
    windowId: String(r.window_id ?? ''),
    distinctId,
    personId: (r.person_id as string | null) ?? null,
    person: personLabel({ id: String(r.person_id ?? distinctId), properties: parseProps(r.person_props), distinctIds: [distinctId] }),
    startTs: Number(r.start_ts),
    endTs: Number(r.end_ts),
    durationMs,
    // Dos chunks pueden contar el mismo segundo de borde: nunca más que la duración.
    activeSeconds: Math.min(Number(r.active_seconds), Math.ceil(durationMs / 1000)),
    clicks: Number(r.clicks),
    firstUrl: (r.first_url as string | null) ?? null,
    pages: parseList(r.pages),
    chunks: Number(r.chunks),
    bytes: Number(r.bytes),
  };
}

const SELECT = `SELECT r.*, m.person_id, p.properties AS person_props FROM analytics_replay_recordings r
  LEFT JOIN analytics_person_ids m ON m.project_id = r.project_id AND m.distinct_id = r.distinct_id
  LEFT JOIN analytics_persons p ON p.id = m.person_id AND p.project_id = r.project_id`;

export function recordingIdFor(projectId: string, sessionId: string, windowId: string): string {
  return `ar_${createHash('sha256').update(`${projectId}\u0001${sessionId}\u0001${windowId}`).digest('hex').slice(0, 28)}`;
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export type StoreResult =
  | { status: 'stored'; bytes: number }
  | { status: 'duplicate' }
  | { status: 'rejected'; http: 413 | 429; error: 'session_too_large' | 'session_too_long' | 'daily_sessions_cap' | 'daily_bytes_cap' };

/**
 * Guarda un chunk ya validado. Idempotente: un reintento del mismo (sesión,
 * ventana, seq) no suma nada. Reserva primero el cupo diario con un UPDATE
 * condicional (dos pedidos a la vez no pasan el tope) y escribe chunk y
 * metadata en un batch: la metadata solo cambia si el chunk entró.
 */
export async function storeChunk(project: Pick<ProjectRow, 'id'>, chunk: ReplayChunk, summary: ChunkSummary, now = Date.now()): Promise<StoreResult> {
  const pid = project.id;
  const id = recordingIdFor(pid, chunk.sessionId, chunk.windowId);
  const db = getDb();
  const rec = (await db
    .prepare(
      `SELECT start_ts, end_ts, bytes, raw_bytes, chunks, pages, (SELECT 1 FROM analytics_replay_chunks c WHERE c.recording_id = r.id AND c.seq = ?) AS dup
       FROM analytics_replay_recordings r WHERE r.id = ?`,
    )
    .get(chunk.seq, id)) as Row | undefined;
  if (rec && Number(rec.dup) === 1) return { status: 'duplicate' };

  const json = JSON.stringify(chunk.events);
  const data = await gzipAsync(json, { level: 6 });
  const bytes = data.byteLength;
  const rawBytes = Buffer.byteLength(json);
  if (rec) {
    if (Number(rec.chunks) + 1 > REPLAY_LIMITS.maxSessionChunks) return { status: 'rejected', http: 413, error: 'session_too_large' };
    const span = Math.max(Number(rec.end_ts), summary.endTs) - Math.min(Number(rec.start_ts), summary.startTs);
    if (span > REPLAY_LIMITS.maxSessionMs) return { status: 'rejected', http: 413, error: 'session_too_long' };
  }
  if (bytes > REPLAY_LIMITS.maxSessionBytes || rawBytes > REPLAY_LIMITS.maxSessionRawBytes) return { status: 'rejected', http: 413, error: 'session_too_large' };

  const client = getClient();
  const day = utcDay(now);
  const isNew = rec ? 0 : 1;
  const [, claim] = await client.batch(
    [
      { sql: 'INSERT OR IGNORE INTO analytics_replay_daily (project_id, day) VALUES (?, ?)', args: [pid, day] },
      {
        sql: `UPDATE analytics_replay_daily SET bytes = bytes + ?1, sessions = sessions + ?2
              WHERE project_id = ?3 AND day = ?4 AND bytes + ?1 <= ?5 AND (?2 = 0 OR sessions < ?6)`,
        args: [bytes, isNew, pid, day, REPLAY_LIMITS.maxBytesPerDay, REPLAY_LIMITS.maxSessionsPerDay],
      },
    ],
    'write',
  );
  if (claim.rowsAffected !== 1) {
    const d = (await db.prepare('SELECT sessions FROM analytics_replay_daily WHERE project_id = ? AND day = ?').get(pid, day)) as { sessions: number } | undefined;
    return { status: 'rejected', http: 429, error: isNew && Number(d?.sessions ?? 0) >= REPLAY_LIMITS.maxSessionsPerDay ? 'daily_sessions_cap' : 'daily_bytes_cap' };
  }

  const pages = JSON.stringify(mergePages(parseList(rec?.pages), summary.pages));
  const firstUrl = summary.pages[0] ?? null;
  const [inserted] = await client.batch(
    [
      {
        // El tope de la sesión va en el mismo INSERT: dos chunks a la vez no lo pasan.
        sql: `INSERT OR IGNORE INTO analytics_replay_chunks (recording_id, project_id, session_id, seq, bytes, raw_bytes, data, created_at)
              SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
              WHERE COALESCE((SELECT bytes FROM analytics_replay_recordings WHERE id = ?1), 0) + ?5 <= ?9
                AND COALESCE((SELECT raw_bytes FROM analytics_replay_recordings WHERE id = ?1), 0) + ?6 <= ?10`,
        args: [id, pid, chunk.sessionId, chunk.seq, bytes, rawBytes, new Uint8Array(data), now, REPLAY_LIMITS.maxSessionBytes, REPLAY_LIMITS.maxSessionRawBytes],
      },
      {
        // changes() es el del INSERT de arriba: sin chunk nuevo, la metadata no se toca.
        sql: `INSERT INTO analytics_replay_recordings (id, project_id, session_id, window_id, distinct_id, start_ts, end_ts, clock_skew_ms, clicks, active_seconds,
                first_url, pages, has_snapshot, chunks, bytes, raw_bytes, created_at)
              SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 1, ?14, ?15, ?16 WHERE changes() = 1
              ON CONFLICT (id) DO UPDATE SET
                first_url = CASE WHEN excluded.start_ts < start_ts THEN COALESCE(excluded.first_url, first_url) ELSE COALESCE(first_url, excluded.first_url) END,
                start_ts = MIN(start_ts, excluded.start_ts),
                end_ts = MAX(end_ts, excluded.end_ts),
                clicks = clicks + excluded.clicks,
                active_seconds = active_seconds + excluded.active_seconds,
                pages = excluded.pages,
                has_snapshot = MAX(has_snapshot, excluded.has_snapshot),
                chunks = chunks + 1,
                bytes = bytes + excluded.bytes,
                raw_bytes = raw_bytes + excluded.raw_bytes`,
        args: [
          id,
          pid,
          chunk.sessionId,
          chunk.windowId,
          chunk.distinctId,
          summary.startTs,
          summary.endTs,
          chunk.skewMs,
          summary.clicks,
          summary.activeSeconds,
          firstUrl,
          pages,
          summary.hasSnapshot ? 1 : 0,
          bytes,
          rawBytes,
          now,
        ],
      },
    ],
    'write',
  );
  if (inserted.rowsAffected === 1) return { status: 'stored', bytes };

  // No entró: se devuelve lo reservado. O ya estaba (otro reintento ganó) o pasó el tope de la sesión.
  await db.prepare('UPDATE analytics_replay_daily SET bytes = MAX(0, bytes - ?), sessions = MAX(0, sessions - ?) WHERE project_id = ? AND day = ?').run(bytes, isNew, pid, day);
  const dup = await db.prepare('SELECT 1 AS x FROM analytics_replay_chunks WHERE recording_id = ? AND seq = ?').get(id, chunk.seq);
  return dup ? { status: 'duplicate' } : { status: 'rejected', http: 413, error: 'session_too_large' };
}

// ---------- Lectura ----------

export interface RecordingsQuery {
  person?: string | null;
  personId?: string | null;
  from?: number | null;
  to?: number | null;
  minDurationMs?: number | null;
  url?: string | null;
  limit?: number;
  offset?: number;
}

function retentionCutoff(project: Pick<ProjectRow, 'retention_days'>, now: number): number {
  return now - recordingRetentionDays(project.retention_days) * DAY;
}

/** Grabaciones que se pueden reproducir (con foto inicial), lo más nuevo primero. */
export async function listRecordings(project: Pick<ProjectRow, 'id' | 'retention_days'>, q: RecordingsQuery = {}, now = Date.now()): Promise<{ recordings: RecordingDto[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const parts = ['r.project_id = ?', 'r.has_snapshot = 1', 'r.start_ts >= ?'];
  const args: Arg[] = [project.id, retentionCutoff(project, now)];
  if (q.from) {
    parts.push('r.start_ts >= ?');
    args.push(q.from);
  }
  if (q.to) {
    parts.push('r.start_ts <= ?');
    args.push(q.to);
  }
  if (q.minDurationMs) {
    parts.push('(r.end_ts - r.start_ts) >= ?');
    args.push(q.minDurationMs);
  }
  if (q.personId) {
    parts.push('m.person_id = ?');
    args.push(q.personId);
  }
  const person = q.person?.trim();
  if (person) {
    parts.push(`(r.distinct_id LIKE ? ESCAPE '\\' OR p.properties LIKE ? ESCAPE '\\')`);
    args.push(likeContains(person), likeContains(person));
  }
  const url = q.url?.trim();
  if (url) {
    parts.push(`r.pages LIKE ? ESCAPE '\\'`);
    // Las barras van escapadas en el JSON guardado.
    args.push(likeContains(JSON.stringify(url.slice(0, 500)).slice(1, -1)));
  }
  const rows = (await getDb()
    .prepare(`${SELECT} WHERE ${parts.join(' AND ')} ORDER BY r.start_ts DESC, r.id LIMIT ? OFFSET ?`)
    .all(...args, limit + 1, Math.max(0, q.offset ?? 0))) as Row[];
  return { recordings: rows.slice(0, limit).map(toDto), hasMore: rows.length > limit };
}

export async function getRecording(project: Pick<ProjectRow, 'id' | 'retention_days'>, id: string, now = Date.now()): Promise<RecordingDto | null> {
  const r = (await getDb()
    .prepare(`${SELECT} WHERE r.id = ? AND r.project_id = ? AND r.has_snapshot = 1 AND r.start_ts >= ?`)
    .get(id, project.id, retentionCutoff(project, now))) as Row | undefined;
  return r ? toDto(r) : null;
}

/** Eventos de Analytics de la sesión, para las marcas de la línea de tiempo. De otra pestaña de la misma sesión, no. */
export async function recordingEvents(project: Pick<ProjectRow, 'id'>, rec: RecordingDto, limit = 500): Promise<LiveEvent[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT id, event, distinct_id, ts, url, pathname, browser, os, device, country, properties FROM analytics_events
       WHERE project_id = ? AND session_id = ? AND ts >= ? AND ts <= ? ORDER BY ts LIMIT ?`,
    )
    .all(project.id, rec.sessionId, rec.startTs - 5000, rec.endTs + 5000, limit)) as Row[];
  return rows.map(toLiveEvent).filter((e) => {
    const w = e.properties.$window_id;
    return typeof w !== 'string' || !rec.windowId || w === rec.windowId;
  });
}

/** Una tanda de chunks a partir de `after`, sin pasar 3 MB (una respuesta de Vercel no puede pasar 4,5 MB y va en base64). */
export async function recordingChunks(recordingId: string, after: number): Promise<{ chunks: Array<{ seq: number; data: string }>; next: number | null }> {
  const db = getDb();
  const sizes = (await db
    .prepare('SELECT seq, bytes FROM analytics_replay_chunks WHERE recording_id = ? AND seq > ? ORDER BY seq LIMIT 200')
    .all(recordingId, after)) as Array<{ seq: number; bytes: number }>;
  if (!sizes.length) return { chunks: [], next: null };
  let total = 0;
  let last = Number(sizes[0].seq);
  let count = 0;
  for (const s of sizes) {
    const b = Number(s.bytes);
    if (count > 0 && total + b > 3 * 1024 * 1024) break;
    total += b;
    last = Number(s.seq);
    count++;
  }
  const rows = (await db
    .prepare('SELECT seq, data FROM analytics_replay_chunks WHERE recording_id = ? AND seq > ? AND seq <= ? ORDER BY seq')
    .all(recordingId, after, last)) as Array<{ seq: number; data: ArrayBuffer | Uint8Array }>;
  return {
    chunks: rows.map((r) => ({ seq: Number(r.seq), data: Buffer.from(r.data as ArrayBuffer).toString('base64') })),
    next: count < sizes.length ? last : null,
  };
}

/** Sesión → grabación, para los links desde eventos en vivo. */
export async function recordingsForSessions(project: Pick<ProjectRow, 'id' | 'retention_days'>, sessionIds: string[], now = Date.now()): Promise<Record<string, string>> {
  const ids = [...new Set(sessionIds)].filter((s) => s.length <= 100).slice(0, 200);
  if (!ids.length) return {};
  const rows = (await getDb()
    .prepare(
      `SELECT session_id, id FROM analytics_replay_recordings
       WHERE project_id = ? AND has_snapshot = 1 AND start_ts >= ? AND session_id IN (${ids.map(() => '?').join(',')}) ORDER BY start_ts DESC`,
    )
    .all(project.id, retentionCutoff(project, now), ...ids)) as Array<{ session_id: string; id: string }>;
  const out: Record<string, string> = {};
  for (const r of rows) out[r.session_id] = r.id;
  return out;
}

// ---------- Borrado ----------

async function dropRecordings(projectId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const marks = ids.map(() => '?').join(',');
  await getClient().batch(
    [
      { sql: `DELETE FROM analytics_replay_chunks WHERE project_id = ? AND recording_id IN (${marks})`, args: [projectId, ...ids] },
      { sql: `DELETE FROM analytics_replay_recordings WHERE project_id = ? AND id IN (${marks})`, args: [projectId, ...ids] },
    ],
    'write',
  );
}

export async function deleteRecording(projectId: string, id: string): Promise<boolean> {
  const found = await getDb().prepare('SELECT 1 AS x FROM analytics_replay_recordings WHERE id = ? AND project_id = ?').get(id, projectId);
  if (!found) return false;
  await dropRecordings(projectId, [id]);
  return true;
}

/** Las grabaciones de estos distinct_ids (borrar una persona se lleva las suyas). */
export async function deleteRecordingsOf(projectId: string, distinctIds: string[]): Promise<void> {
  if (!distinctIds.length) return;
  const db = getDb();
  for (let round = 0; round < 200; round++) {
    const rows = (await db
      .prepare(`SELECT id FROM analytics_replay_recordings WHERE project_id = ? AND distinct_id IN (${distinctIds.map(() => '?').join(',')}) LIMIT 50`)
      .all(projectId, ...distinctIds)) as Array<{ id: string }>;
    await dropRecordings(projectId, rows.map((r) => r.id));
    if (rows.length < 50) break;
  }
}

/** Purga las grabaciones de un proyecto borrado. true si no quedó nada; si se acabó el tiempo sigue en la próxima corrida. */
export async function purgeProjectRecordings(projectId: string, left: () => number): Promise<boolean> {
  const db = getDb();
  while (left() > 0) {
    const res = await db
      .prepare('DELETE FROM analytics_replay_chunks WHERE rowid IN (SELECT rowid FROM analytics_replay_chunks WHERE project_id = ? LIMIT 200)')
      .run(projectId);
    if (res.changes < 200) {
      await db.prepare('DELETE FROM analytics_replay_recordings WHERE project_id = ?').run(projectId);
      return true;
    }
  }
  return false;
}

const RETENTION_EVERY_MS = 50 * 60_000;
/** Grabaciones por proyecto en una corrida: uno con años de datos no se come el tiempo de los demás. */
const RECORDINGS_PER_PROJECT = 200;

/**
 * Retención (una vez por hora por proyecto, reclamado con compare-and-set): lo
 * más viejo que 30 días o que la retención del proyecto. Primero el proyecto
 * que hace más que no se atiende, así nadie queda sin turno.
 */
export async function runReplayRetention(opts: { now?: number; budgetMs?: number } = {}): Promise<number> {
  const started = Date.now();
  const now = opts.now ?? started;
  const budget = opts.budgetMs ?? 4000;
  const left = () => budget - (Date.now() - started);
  const db = getDb();
  let purged = 0;
  const due = (await db
    .prepare(
      `SELECT p.id, p.retention_days FROM analytics_projects p
       WHERE p.deleted_at IS NULL AND (p.replay_purged_at IS NULL OR p.replay_purged_at < ?)
         AND EXISTS (SELECT 1 FROM analytics_replay_recordings r WHERE r.project_id = p.id)
       ORDER BY p.replay_purged_at IS NOT NULL, p.replay_purged_at LIMIT 50`,
    )
    .all(now - RETENTION_EVERY_MS)) as Array<{ id: string; retention_days: number }>;
  for (const p of due) {
    if (left() <= 0) break;
    try {
      const claim = await db
        .prepare('UPDATE analytics_projects SET replay_purged_at = ? WHERE id = ? AND (replay_purged_at IS NULL OR replay_purged_at < ?)')
        .run(now, p.id, now - RETENTION_EVERY_MS);
      if (claim.changes !== 1) continue;
      const cutoff = retentionCutoff(p, now);
      let done = 0;
      while (done < RECORDINGS_PER_PROJECT && left() > 0) {
        const rows = (await db
          .prepare('SELECT id FROM analytics_replay_recordings WHERE project_id = ? AND end_ts < ? LIMIT 25')
          .all(p.id, cutoff)) as Array<{ id: string }>;
        if (!rows.length) break;
        await dropRecordings(p.id, rows.map((r) => r.id));
        done += rows.length;
      }
      purged += done;
    } catch (err) {
      // Un proyecto que falla no frena a los demás.
      console.error('[analytics cron] replay retention', p.id, err);
    }
  }
  await db.prepare('DELETE FROM analytics_replay_daily WHERE day < ?').run(utcDay(now - 3 * DAY));
  return purged;
}
