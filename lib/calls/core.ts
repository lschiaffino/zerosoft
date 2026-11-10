/**
 * Calls: biblioteca, una llamada, comentarios con momento, clips, link
 * compartido y el archivo de la grabación. Server-only.
 *
 * Quién ve qué:
 * - Admins (y el owner): todo el workspace.
 * - El resto: sus llamadas y, con visibilidad "team" (por defecto), las del equipo.
 * - Guests: nada (las rutas ni entran).
 * - El nombre del deal solo se muestra si la persona ve ese deal en el CRM.
 * Cambiar o borrar una llamada: quien la grabó o un admin. Comentar y armar
 * clips: cualquiera que la ve.
 */
import { getDb } from '../db';
import { listOwnerSpacePeople } from '../workspace';
import { canSeeOwner, type OwnerScope } from '../crm-visibility';
import { createNotification } from '../notifications';
import { localized } from '../notification-copy';
import { deleteCallFiles, readCallFile, storeCallFile } from './files';
import { getSettings } from './settings';
import {
  CallsError,
  LIBRARY_STATUSES,
  LIVE_STATUSES,
  MAX_AUDIO_SEGMENTS,
  MAX_VIDEO_PARTS,
  PART_BYTES,
  newId,
  newToken,
  nowIso,
  parseJson,
  type Attendee,
  type CallAnalysis,
  type CallMetrics,
  type CallPlatform,
  type CallSource,
  type CallStatus,
  type CallsActor,
  type Speaker,
  type SpeakerSide,
  type Utterance,
} from './types';

export interface CallRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  title: string;
  source: CallSource;
  platform: CallPlatform;
  meeting_url: string | null;
  event_key: string | null;
  scheduled_at: string | null;
  scheduled_end: string | null;
  status: CallStatus;
  join_mode: string;
  will_join: number;
  dispatch_attempts: number;
  dispatched_at: string | null;
  bot_token_hash: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number;
  end_reason: string | null;
  error: string | null;
  video_mime: string | null;
  video_bytes: number;
  video_parts: number;
  audio_mime: string | null;
  audio_segments: number;
  attendees: string;
  participants: string;
  speakers: string;
  speaker_timeline: string;
  captions: string;
  transcript: string | null;
  transcript_text: string;
  language: string | null;
  analysis: string | null;
  metrics: string | null;
  processing_claimed_at: string | null;
  processing_attempts: number;
  deal_id: string | null;
  contact_ids: string;
  crm_activity_id: string | null;
  posted_at: string | null;
  share_token: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CallListItem {
  id: string;
  title: string;
  status: CallStatus;
  platform: CallPlatform;
  source: CallSource;
  ownerId: string;
  ownerName: string;
  at: string;
  durationMs: number;
  deal: { id: string; name: string } | null;
  speakers: number;
  talkRatio: number | null;
  summary: string;
  error: string | null;
}

export interface CommentDto {
  id: string;
  authorId: string;
  authorName: string;
  atMs: number | null;
  body: string;
  createdAt: string;
  canDelete: boolean;
}

export interface ClipDto {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  createdBy: string;
  createdAt: string;
  canDelete: boolean;
}

export interface CallDetail {
  id: string;
  title: string;
  status: CallStatus;
  platform: CallPlatform;
  source: CallSource;
  meetingUrl: string | null;
  ownerId: string;
  ownerName: string;
  at: string;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number;
  endReason: string | null;
  error: string | null;
  hasVideo: boolean;
  mediaMime: string | null;
  attendees: Attendee[];
  participants: string[];
  speakers: Speaker[];
  transcript: Utterance[];
  analysis: CallAnalysis | null;
  metrics: CallMetrics | null;
  deal: { id: string; name: string } | null;
  contactIds: string[];
  crmActivityId: string | null;
  shared: boolean;
  shareToken: string | null;
  canEdit: boolean;
  comments: CommentDto[];
  clips: ClipDto[];
}

const db = () => getDb();

/** Condición de visibilidad sobre el alias `c` (args: admin, persona, visibilidad). */
function visSql(actor: CallsActor, visibility: 'team' | 'private'): { sql: string; args: Array<string | number> } {
  return { sql: `(? = 1 OR c.owner_id = ? OR ? = 'team')`, args: [actor.admin ? 1 : 0, actor.person, visibility] };
}

export function canEditCall(actor: CallsActor, row: Pick<CallRow, 'owner_id'>): boolean {
  return actor.admin || row.owner_id === actor.person;
}

async function rowFor(actor: CallsActor, id: string): Promise<CallRow> {
  const settings = await getSettings(actor.ws);
  const v = visSql(actor, settings.visibility);
  const row = (await db()
    .prepare(`SELECT c.* FROM calls c WHERE c.id = ? AND c.workspace_id = ? AND c.deleted_at IS NULL AND ${v.sql}`)
    .get(id, actor.ws, ...v.args)) as CallRow | undefined;
  if (!row) throw new CallsError('not_found', 404);
  return row;
}

export async function getCallRow(actor: CallsActor, id: string): Promise<CallRow> {
  return rowFor(actor, id);
}

export async function getCallById(id: string): Promise<CallRow | null> {
  return ((await db().prepare('SELECT * FROM calls WHERE id = ? AND deleted_at IS NULL').get(id)) as CallRow | undefined) ?? null;
}

export interface ListFilters {
  q?: string;
  owner?: string;
  deal?: string;
  from?: string;
  to?: string;
  minMinutes?: number;
  maxMinutes?: number;
  limit?: number;
}

function likeOf(term: string): string {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/** Biblioteca: llamadas que la persona ve, más nuevas primero. */
export async function listCalls(actor: CallsActor, f: ListFilters = {}, scope: OwnerScope = null): Promise<CallListItem[]> {
  const settings = await getSettings(actor.ws);
  const v = visSql(actor, settings.visibility);
  const where: string[] = ['c.workspace_id = ?', 'c.deleted_at IS NULL', `c.status IN (${LIBRARY_STATUSES.map(() => '?').join(',')})`, v.sql];
  const args: Array<string | number> = [actor.ws, ...LIBRARY_STATUSES, ...v.args];
  const q = (f.q ?? '').trim();
  if (q) {
    where.push(`(c.title LIKE ? ESCAPE '\\' OR c.transcript_text LIKE ? ESCAPE '\\')`);
    args.push(likeOf(q), likeOf(q));
  }
  if (f.owner) {
    where.push('c.owner_id = ?');
    args.push(f.owner);
  }
  if (f.deal) {
    where.push('c.deal_id = ?');
    args.push(f.deal);
  }
  const at = `COALESCE(c.started_at, c.scheduled_at, c.created_at)`;
  if (f.from && /^\d{4}-\d{2}-\d{2}/.test(f.from)) {
    where.push(`${at} >= ?`);
    args.push(f.from.slice(0, 10));
  }
  if (f.to && /^\d{4}-\d{2}-\d{2}/.test(f.to)) {
    where.push(`${at} < date(?, '+1 day')`);
    args.push(f.to.slice(0, 10));
  }
  if (f.minMinutes && f.minMinutes > 0) {
    where.push('c.duration_ms >= ?');
    args.push(Math.round(f.minMinutes * 60_000));
  }
  if (f.maxMinutes && f.maxMinutes > 0) {
    where.push('c.duration_ms <= ?');
    args.push(Math.round(f.maxMinutes * 60_000));
  }
  const rows = (await db()
    .prepare(
      `SELECT c.id, c.title, c.status, c.platform, c.source, c.owner_id, c.duration_ms, c.deal_id, c.speakers, c.metrics, c.analysis, c.error, c.workspace_id,
              ${at} AS at, u.name AS owner_name, u.email AS owner_email, d.name AS deal_name, d.owner_id AS deal_owner
       FROM calls c LEFT JOIN users u ON u.id = c.owner_id LEFT JOIN crm_deals d ON d.id = c.deal_id AND d.user_id = c.workspace_id
       WHERE ${where.join(' AND ')}
       ORDER BY ${at} DESC LIMIT ?`,
    )
    .all(...args, Math.min(500, f.limit ?? 200))) as Array<{
    id: string;
    title: string;
    status: CallStatus;
    platform: CallPlatform;
    source: CallSource;
    owner_id: string;
    duration_ms: number;
    deal_id: string | null;
    speakers: string;
    metrics: string | null;
    analysis: string | null;
    error: string | null;
    workspace_id: string;
    at: string;
    owner_name: string | null;
    owner_email: string | null;
    deal_name: string | null;
    deal_owner: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    platform: r.platform,
    source: r.source,
    ownerId: r.owner_id,
    ownerName: r.owner_name || r.owner_email || '',
    at: r.at,
    durationMs: Number(r.duration_ms) || 0,
    deal: r.deal_id && r.deal_name !== null && canSeeOwner(scope, r.deal_owner, r.workspace_id) ? { id: r.deal_id, name: r.deal_name } : null,
    speakers: parseJson<Speaker[]>(r.speakers, []).length,
    talkRatio: parseJson<CallMetrics | null>(r.metrics, null)?.talkRatio ?? null,
    summary: (parseJson<CallAnalysis | null>(r.analysis, null)?.summary ?? '').slice(0, 280),
    error: r.error,
  }));
}

/** Personas del workspace con Calls (filtro de rep). */
export async function listReps(actor: CallsActor): Promise<Array<{ id: string; name: string }>> {
  const people = await listOwnerSpacePeople(actor.ws, { app: 'calls' });
  return people.map((p) => ({ id: p.id, name: p.name || p.email }));
}

async function dealOf(row: CallRow, scope: OwnerScope): Promise<{ id: string; name: string } | null> {
  if (!row.deal_id) return null;
  const d = (await db().prepare('SELECT id, name, owner_id FROM crm_deals WHERE id = ? AND user_id = ?').get(row.deal_id, row.workspace_id)) as
    | { id: string; name: string; owner_id: string | null }
    | undefined;
  if (!d || !canSeeOwner(scope, d.owner_id, row.workspace_id)) return null;
  return { id: d.id, name: d.name };
}

export async function getCallDetail(actor: CallsActor, id: string, scope: OwnerScope = null): Promise<CallDetail> {
  const row = await rowFor(actor, id);
  const [owner, deal, comments, clips] = await Promise.all([
    db().prepare('SELECT name, email FROM users WHERE id = ?').get(row.owner_id) as Promise<{ name: string | null; email: string } | undefined>,
    dealOf(row, scope),
    listComments(actor, row),
    listClips(actor, row),
  ]);
  const edit = canEditCall(actor, row);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    platform: row.platform,
    source: row.source,
    meetingUrl: edit ? row.meeting_url : null,
    ownerId: row.owner_id,
    ownerName: owner?.name || owner?.email || '',
    at: row.started_at ?? row.scheduled_at ?? row.created_at,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: Number(row.duration_ms) || 0,
    endReason: row.end_reason,
    error: row.error,
    hasVideo: Number(row.video_parts) > 0 && Number(row.video_bytes) > 0,
    mediaMime: row.video_mime,
    attendees: parseJson<Attendee[]>(row.attendees, []),
    participants: parseJson<Array<{ name: string }>>(row.participants, []).map((p) => p.name).filter(Boolean),
    speakers: parseJson<Speaker[]>(row.speakers, []),
    transcript: parseJson<Utterance[]>(row.transcript, []),
    analysis: parseJson<CallAnalysis | null>(row.analysis, null),
    metrics: parseJson<CallMetrics | null>(row.metrics, null),
    deal,
    contactIds: parseJson<string[]>(row.contact_ids, []),
    crmActivityId: row.crm_activity_id && row.crm_activity_id !== 'pending' ? row.crm_activity_id : null,
    shared: Boolean(row.share_token),
    shareToken: edit ? row.share_token : null,
    canEdit: edit,
    comments,
    clips,
  };
}

// ---------- Cambios ----------

export interface CallPatch {
  title?: string;
  dealId?: string | null;
  speakers?: Array<{ id: string; name?: string; side?: SpeakerSide }>;
}

export async function updateCall(actor: CallsActor, id: string, patch: CallPatch, scope: OwnerScope = null): Promise<CallRow> {
  const row = await rowFor(actor, id);
  if (!canEditCall(actor, row)) throw new CallsError('forbidden', 403);
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  if (patch.title !== undefined) {
    const t = patch.title.trim().slice(0, 200);
    if (!t) throw new CallsError('invalid_input', 400);
    sets.push('title = ?');
    args.push(t);
  }
  if (patch.dealId !== undefined) {
    if (patch.dealId) {
      const d = (await db().prepare('SELECT owner_id FROM crm_deals WHERE id = ? AND user_id = ?').get(patch.dealId, actor.ws)) as { owner_id: string | null } | undefined;
      if (!d || !canSeeOwner(scope, d.owner_id, actor.ws)) throw new CallsError('deal_not_found', 404);
    }
    sets.push('deal_id = ?');
    args.push(patch.dealId || null);
  }
  if (patch.speakers) {
    const cur = parseJson<Speaker[]>(row.speakers, []);
    const byId = new Map(patch.speakers.map((s) => [s.id, s]));
    const next = cur.map((s) => {
      const p = byId.get(s.id);
      if (!p) return s;
      return { ...s, ...(p.name?.trim() ? { name: p.name.trim().slice(0, 120) } : {}), ...(p.side ? { side: p.side } : {}) };
    });
    sets.push('speakers = ?');
    args.push(JSON.stringify(next));
    // Lado de un hablante cambia la proporción de habla: se recalcula sin IA.
    const { computeMetrics } = await import('./metrics');
    sets.push('metrics = ?');
    args.push(JSON.stringify(computeMetrics(parseJson<Utterance[]>(row.transcript, []), next)));
  }
  if (!sets.length) return row;
  sets.push('updated_at = ?');
  args.push(nowIso());
  await db().prepare(`UPDATE calls SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  const updated = (await getCallById(id))!;
  if (patch.dealId !== undefined && updated.status === 'ready') {
    // El deal nuevo recibe la actividad (o se actualiza la que ya había).
    const { logCallToCrm } = await import('./crm');
    await logCallToCrm(updated).catch(() => null);
  }
  return updated;
}

/** Borra la llamada y su grabación. Si el bot está en la reunión, primero sale. */
export async function deleteCall(actor: CallsActor, id: string): Promise<void> {
  const row = await rowFor(actor, id);
  if (!canEditCall(actor, row)) throw new CallsError('forbidden', 403);
  if ((LIVE_STATUSES as readonly string[]).includes(row.status) && row.dispatched_at) {
    const { stopBot } = await import('./bot');
    await stopBot(row.id).catch(() => null);
  }
  await removeCall(row.id);
}

export async function removeCall(id: string): Promise<void> {
  const parts = (await db().prepare('SELECT ref FROM calls_parts WHERE call_id = ?').all(id)) as Array<{ ref: string }>;
  await db().prepare('DELETE FROM calls WHERE id = ?').run(id);
  await deleteCallFiles(parts.map((p) => p.ref)).catch(() => undefined);
}

// ---------- Comentarios ----------

async function listComments(actor: CallsActor, row: CallRow): Promise<CommentDto[]> {
  const rows = (await db()
    .prepare('SELECT id, author_id, author_name, at_ms, body, created_at FROM calls_comments WHERE call_id = ? ORDER BY COALESCE(at_ms, 9e15), created_at')
    .all(row.id)) as Array<{ id: string; author_id: string; author_name: string; at_ms: number | null; body: string; created_at: string }>;
  return rows.map((c) => ({
    id: c.id,
    authorId: c.author_id,
    authorName: c.author_name,
    atMs: c.at_ms === null ? null : Number(c.at_ms),
    body: c.body,
    createdAt: c.created_at,
    canDelete: c.author_id === actor.person || canEditCall(actor, row),
  }));
}

export async function addComment(actor: CallsActor, callId: string, input: { body: string; atMs?: number | null }): Promise<CommentDto> {
  const row = await rowFor(actor, callId);
  const body = input.body.trim().slice(0, 4000);
  if (!body) throw new CallsError('invalid_input', 400);
  const atMs = input.atMs === null || input.atMs === undefined ? null : Math.max(0, Math.round(input.atMs));
  const id = newId('cmt');
  const ts = nowIso();
  await db()
    .prepare('INSERT INTO calls_comments (id, call_id, workspace_id, author_id, author_name, at_ms, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, row.id, actor.ws, actor.person, actor.name.slice(0, 120), atMs, body, ts);
  if (row.owner_id !== actor.person) {
    await createNotification({
      userId: row.owner_id,
      type: 'calls_activity',
      title: localized('callsComment', { who: actor.name || null, title: row.title || null }),
      body: body.slice(0, 200),
      href: `/app/calls/call/${row.id}${atMs !== null ? `?t=${Math.floor(atMs / 1000)}` : ''}`,
      sourceType: 'call',
      sourceId: row.id,
    }).catch(() => null);
  }
  return { id, authorId: actor.person, authorName: actor.name, atMs, body, createdAt: ts, canDelete: true };
}

export async function deleteComment(actor: CallsActor, callId: string, commentId: string): Promise<void> {
  const row = await rowFor(actor, callId);
  const c = (await db().prepare('SELECT author_id FROM calls_comments WHERE id = ? AND call_id = ?').get(commentId, row.id)) as { author_id: string } | undefined;
  if (!c) throw new CallsError('not_found', 404);
  if (c.author_id !== actor.person && !canEditCall(actor, row)) throw new CallsError('forbidden', 403);
  await db().prepare('DELETE FROM calls_comments WHERE id = ?').run(commentId);
}

// ---------- Clips ----------

async function listClips(actor: CallsActor, row: CallRow): Promise<ClipDto[]> {
  const rows = (await db()
    .prepare('SELECT id, title, start_ms, end_ms, created_by, created_at FROM calls_clips WHERE call_id = ? ORDER BY start_ms')
    .all(row.id)) as Array<{ id: string; title: string; start_ms: number; end_ms: number; created_by: string; created_at: string }>;
  return rows.map((c) => ({
    id: c.id,
    title: c.title,
    startMs: Number(c.start_ms),
    endMs: Number(c.end_ms),
    createdBy: c.created_by,
    createdAt: c.created_at,
    canDelete: c.created_by === actor.person || canEditCall(actor, row),
  }));
}

export async function createClip(actor: CallsActor, callId: string, input: { title: string; startMs: number; endMs: number }): Promise<ClipDto> {
  const row = await rowFor(actor, callId);
  const title = input.title.trim().slice(0, 200);
  const start = Math.max(0, Math.round(input.startMs));
  const limit = Number(row.duration_ms) > 0 ? Number(row.duration_ms) + 1000 : Number.MAX_SAFE_INTEGER;
  const end = Math.min(limit, Math.round(input.endMs));
  if (!title || end - start < 1000) throw new CallsError('invalid_clip', 400);
  const count = (await db().prepare('SELECT COUNT(*) AS n FROM calls_clips WHERE call_id = ?').get(row.id)) as { n: number };
  if (Number(count.n) >= 100) throw new CallsError('too_many_clips', 400);
  const id = newId('clip');
  const ts = nowIso();
  await db().prepare('INSERT INTO calls_clips (id, call_id, workspace_id, created_by, title, start_ms, end_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, row.id, actor.ws, actor.person, title, start, end, ts);
  return { id, title, startMs: start, endMs: end, createdBy: actor.person, createdAt: ts, canDelete: true };
}

export async function updateClip(actor: CallsActor, callId: string, clipId: string, input: { title: string }): Promise<void> {
  const row = await rowFor(actor, callId);
  const c = (await db().prepare('SELECT created_by FROM calls_clips WHERE id = ? AND call_id = ?').get(clipId, row.id)) as { created_by: string } | undefined;
  if (!c) throw new CallsError('not_found', 404);
  if (c.created_by !== actor.person && !canEditCall(actor, row)) throw new CallsError('forbidden', 403);
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new CallsError('invalid_input', 400);
  await db().prepare('UPDATE calls_clips SET title = ? WHERE id = ?').run(title, clipId);
}

export async function deleteClip(actor: CallsActor, callId: string, clipId: string): Promise<void> {
  const row = await rowFor(actor, callId);
  const c = (await db().prepare('SELECT created_by FROM calls_clips WHERE id = ? AND call_id = ?').get(clipId, row.id)) as { created_by: string } | undefined;
  if (!c) throw new CallsError('not_found', 404);
  if (c.created_by !== actor.person && !canEditCall(actor, row)) throw new CallsError('forbidden', 403);
  await db().prepare('DELETE FROM calls_clips WHERE id = ?').run(clipId);
}

// ---------- Link compartido ----------

/** Prende (o rota) el link público de solo lectura. Solo quien grabó o un admin. */
export async function enableShare(actor: CallsActor, id: string): Promise<string> {
  const row = await rowFor(actor, id);
  if (!canEditCall(actor, row)) throw new CallsError('forbidden', 403);
  if (row.status !== 'ready') throw new CallsError('not_ready', 409);
  const token = newToken();
  await db().prepare('UPDATE calls SET share_token = ?, updated_at = ? WHERE id = ?').run(token, nowIso(), id);
  return token;
}

export async function disableShare(actor: CallsActor, id: string): Promise<void> {
  const row = await rowFor(actor, id);
  if (!canEditCall(actor, row)) throw new CallsError('forbidden', 403);
  await db().prepare('UPDATE calls SET share_token = NULL, updated_at = ? WHERE id = ?').run(nowIso(), id);
}

export interface SharedCall {
  id: string;
  title: string;
  at: string;
  durationMs: number;
  hasVideo: boolean;
  speakers: Speaker[];
  transcript: Utterance[];
  summary: string;
  nextSteps: CallAnalysis['nextSteps'];
}

/**
 * Lo que ve quien tiene el link: grabación, transcripción, resumen y próximos
 * pasos. Nada interno (comentarios, scorecard, deal, objeciones). Un link
 * deja de servir si quien grabó ya no está en el workspace.
 */
export async function getSharedCall(token: string): Promise<{ row: CallRow; view: SharedCall } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const row = (await db().prepare("SELECT * FROM calls WHERE share_token = ? AND deleted_at IS NULL AND status = 'ready'").get(token)) as CallRow | undefined;
  if (!row) return null;
  const people = await listOwnerSpacePeople(row.workspace_id, { app: 'calls' });
  if (!people.some((p) => p.id === row.owner_id)) return null;
  const analysis = parseJson<CallAnalysis | null>(row.analysis, null);
  return {
    row,
    view: {
      id: row.id,
      title: row.title,
      at: row.started_at ?? row.created_at,
      durationMs: Number(row.duration_ms) || 0,
      hasVideo: Number(row.video_parts) > 0,
      speakers: parseJson<Speaker[]>(row.speakers, []).map((s) => ({ id: s.id, name: s.name, side: s.side })),
      transcript: parseJson<Utterance[]>(row.transcript, []),
      summary: analysis?.summary ?? '',
      nextSteps: analysis?.nextSteps ?? [],
    },
  };
}

// ---------- Archivo de la grabación ----------

export async function storeCallPart(callId: string, kind: 'video' | 'audio', n: number, bytes: Buffer, mime: string, startMs = 0): Promise<void> {
  if (!Number.isInteger(n) || n < 0 || n >= (kind === 'video' ? MAX_VIDEO_PARTS : MAX_AUDIO_SEGMENTS)) throw new CallsError('invalid_part', 400);
  if (bytes.length === 0 || bytes.length > PART_BYTES) throw new CallsError('invalid_part', 400);
  const ref = await storeCallFile(bytes, kind === 'video' ? 'application/octet-stream' : mime);
  const old = (await db().prepare('SELECT ref FROM calls_parts WHERE call_id = ? AND kind = ? AND n = ?').get(callId, kind, n)) as { ref: string } | undefined;
  await db()
    .prepare(
      `INSERT INTO calls_parts (call_id, kind, n, ref, size, mime, start_ms) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (call_id, kind, n) DO UPDATE SET ref = excluded.ref, size = excluded.size, mime = excluded.mime, start_ms = excluded.start_ms, transcript = NULL`,
    )
    .run(callId, kind, n, ref, bytes.length, mime.slice(0, 80), Math.max(0, Math.round(startMs)));
  if (old && old.ref !== ref) await deleteCallFiles([old.ref]).catch(() => undefined);
}

/** Bytes [start, end] del video (de las partes de 4 MB). */
export async function readVideoRange(callId: string, start: number, end: number): Promise<Buffer> {
  const from = Math.floor(start / PART_BYTES);
  const to = Math.floor(end / PART_BYTES);
  const parts = (await db()
    .prepare("SELECT n, ref FROM calls_parts WHERE call_id = ? AND kind = 'video' AND n >= ? AND n <= ? ORDER BY n")
    .all(callId, from, to)) as Array<{ n: number; ref: string }>;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    const bytes = await readCallFile(p.ref);
    if (!bytes) return Buffer.alloc(0);
    const offset = Number(p.n) * PART_BYTES;
    const s = Math.max(0, start - offset);
    const e = Math.min(bytes.length, end - offset + 1);
    if (e > s) chunks.push(bytes.subarray(s, e));
  }
  return Buffer.concat(chunks);
}

export async function videoParts(callId: string): Promise<Array<{ n: number; size: number }>> {
  return ((await db().prepare("SELECT n, size FROM calls_parts WHERE call_id = ? AND kind = 'video' ORDER BY n").all(callId)) as Array<{ n: number; size: number }>).map((p) => ({
    n: Number(p.n),
    size: Number(p.size),
  }));
}

/** MIME para servir: el guardado, o el que dicen los primeros bytes. */
export function mediaMime(row: Pick<CallRow, 'video_mime'>, head: Buffer): string {
  const m = (row.video_mime ?? '').split(';')[0].trim().toLowerCase();
  if (/^(video|audio)\/[a-z0-9.+-]+$/.test(m)) return m;
  if (head.subarray(4, 8).toString('latin1') === 'ftyp') return 'video/mp4';
  if (head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF') return 'audio/wav';
  if (head.subarray(0, 4).toString('latin1') === 'OggS') return 'audio/ogg';
  return 'application/octet-stream';
}

// ---------- Subida de una grabación ----------

const UPLOAD_MIME = /^(video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|x-m4a|m4a|wav|x-wav|webm|ogg|aac|flac))$/;

/** Llamada nueva desde un archivo: el navegador manda las partes y después /complete. */
export async function createUpload(actor: CallsActor, input: { title: string; mime: string; size: number }): Promise<{ id: string; parts: number }> {
  const mime = input.mime.split(';')[0].trim().toLowerCase();
  if (!UPLOAD_MIME.test(mime)) throw new CallsError('unsupported_file', 400);
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > MAX_VIDEO_PARTS * PART_BYTES) throw new CallsError('file_too_large', 413);
  const { callsStorageConfigured } = await import('./files');
  if (!callsStorageConfigured()) throw new CallsError('storage_unavailable', 503);
  const id = newId();
  const ts = nowIso();
  const parts = Math.ceil(input.size / PART_BYTES);
  await db()
    .prepare(
      `INSERT INTO calls (id, workspace_id, owner_id, title, source, platform, status, video_mime, video_bytes, video_parts, started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'upload', 'upload', 'uploading', ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, actor.ws, actor.person, input.title.trim().slice(0, 200) || 'Recording', mime, Math.round(input.size), parts, ts, ts, ts);
  return { id, parts };
}

export async function storeUploadPart(actor: CallsActor, callId: string, n: number, bytes: Buffer): Promise<void> {
  const row = await rowFor(actor, callId);
  if (row.source !== 'upload' || row.status !== 'uploading' || row.owner_id !== actor.person) throw new CallsError('not_uploading', 409);
  if (n >= Number(row.video_parts)) throw new CallsError('invalid_part', 400);
  await storeCallPart(row.id, 'video', n, bytes, row.video_mime ?? 'application/octet-stream');
}

export async function completeUpload(actor: CallsActor, callId: string, durationMs: number): Promise<void> {
  const row = await rowFor(actor, callId);
  if (row.source !== 'upload' || row.owner_id !== actor.person) throw new CallsError('not_uploading', 409);
  if (row.status !== 'uploading') return;
  const parts = await videoParts(row.id);
  const total = parts.reduce((s, p) => s + p.size, 0);
  if (parts.length !== Number(row.video_parts) || total !== Number(row.video_bytes)) throw new CallsError('upload_incomplete', 409);
  await db()
    .prepare("UPDATE calls SET status = 'processing', duration_ms = ?, ended_at = ?, updated_at = ? WHERE id = ? AND status = 'uploading'")
    .run(Math.max(0, Math.round(durationMs || 0)), nowIso(), nowIso(), row.id);
}

/** Subidas abandonadas (más de un día sin terminar): se borran con sus partes. */
export async function purgeAbandonedUploads(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const rows = (await db().prepare("SELECT id FROM calls WHERE source = 'upload' AND status = 'uploading' AND created_at < ? LIMIT 50").all(cutoff)) as Array<{ id: string }>;
  for (const r of rows) await removeCall(r.id);
  return rows.length;
}

export function newShareToken(): string {
  return newToken();
}
