/**
 * Rec (como Loom): videos de pantalla y cámara del workspace. Server-only.
 *
 * - Biblioteca: cada video es de quien lo grabó ("Mis videos", espacio
 *   personal) o del workspace (espacio compartido, lo ven todos los
 *   miembros). Carpetas por espacio.
 * - Subida: el navegador sube por partes mientras graba (Blob multipart con
 *   un token de cliente para un path exacto, o partes al disco local en dev
 *   y self-host, que se juntan al completar). Ver lib/rec-upload.ts.
 * - Página pública /v/<share_id>: link (cualquiera) o workspace (miembros
 *   logueados), contraseña opcional y vencimiento. Cada espectador abre una
 *   vista con pings de lo visto; la primera vez de cada uno avisa al autor.
 * - Comentarios y reacciones con el segundo del video; avisan al autor.
 * - Transcripción, título, resumen y capítulos: lib/rec-ai.ts (cron/after).
 */
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { getDb } from './db';
import { deleteUploads } from './uploads';
import {
  chaptersToText,
  clampTrim,
  cleanCtaUrl,
  normalizeChapters,
  parseChapters,
  trimmedDuration,
  viewPct,
  viewStats,
  type RecChapter,
  type RecCtaMode,
  type RecMode,
  type RecPrivacy,
  type RecSegment,
  type RecSpace,
  type RecTranscriptStatus,
} from './rec-schema';

const scrypt = promisify(scryptCb) as (pw: string, salt: string, len: number) => Promise<Buffer>;

export class RecError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

/** Quién pide: workspace (dueño de los datos), persona real, admin y nombre. */
export interface RecActor {
  ws: string;
  actor: string;
  admin: boolean;
  name: string;
}

export function nowDb(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function dbTime(d: string): number {
  return new Date(`${d.replace(' ', 'T')}Z`).getTime();
}

function newShareId(): string {
  return randomBytes(12).toString('base64url');
}

export function hashIp(ip: string): string {
  return ip ? createHash('sha256').update(`${process.env.NEXTAUTH_SECRET ?? ''}:rec:${ip}`).digest('hex').slice(0, 32) : '';
}

// ============================================================
// Filas
// ============================================================

export interface RecFolderRow {
  id: string;
  workspace_id: string;
  space: RecSpace;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface RecVideoRow {
  id: string;
  workspace_id: string;
  created_by: string;
  share_id: string;
  title: string;
  title_source: 'auto' | 'user';
  description: string;
  chapters: string;
  chapters_source: 'auto' | 'user';
  folder_id: string | null;
  space: RecSpace;
  mode: RecMode;
  status: 'recording' | 'ready' | 'failed';
  url: string | null;
  content_type: string;
  size: number;
  audio_url: string | null;
  thumb_url: string | null;
  gif_url: string | null;
  duration_sec: number;
  width: number;
  height: number;
  trim_start: number;
  trim_end: number | null;
  privacy: RecPrivacy;
  password_hash: string | null;
  expires_at: string | null;
  allow_download: number;
  allow_comments: number;
  notify: number;
  cta_label: string | null;
  cta_url: string | null;
  cta_mode: RecCtaMode;
  transcript: string;
  transcript_status: RecTranscriptStatus;
  transcript_error: string | null;
  transcript_lang: string | null;
  summary: string;
  processing_at: string | null;
  views: number;
  last_viewed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Lo que ve la UI de la app (sin hash de contraseña ni URLs crudas del almacenamiento). */
export interface RecVideoDto {
  id: string;
  shareId: string;
  title: string;
  description: string;
  chapters: RecChapter[];
  chaptersText: string;
  folderId: string | null;
  space: RecSpace;
  mode: RecMode;
  status: RecVideoRow['status'];
  contentType: string;
  size: number;
  durationSec: number;
  width: number;
  height: number;
  trimStart: number;
  trimEnd: number | null;
  privacy: RecPrivacy;
  hasPassword: boolean;
  expiresAt: string | null;
  allowDownload: boolean;
  allowComments: boolean;
  notify: boolean;
  ctaLabel: string;
  ctaUrl: string;
  ctaMode: RecCtaMode;
  transcript: RecSegment[];
  transcriptStatus: RecTranscriptStatus;
  transcriptError: string | null;
  summary: string;
  hasThumb: boolean;
  hasGif: boolean;
  views: number;
  lastViewedAt: string | null;
  createdBy: string;
  authorName: string;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  try {
    const v = JSON.parse(text ?? '');
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function toDto(row: RecVideoRow & { author_name?: string | null }, actor: RecActor | null): RecVideoDto {
  const chapters = parseJson<RecChapter[]>(row.chapters, []);
  return {
    id: row.id,
    shareId: row.share_id,
    title: row.title,
    description: row.description,
    chapters,
    chaptersText: chaptersToText(chapters),
    folderId: row.folder_id,
    space: row.space,
    mode: row.mode,
    status: row.status,
    contentType: row.content_type,
    size: row.size,
    durationSec: row.duration_sec,
    width: row.width,
    height: row.height,
    trimStart: row.trim_start,
    trimEnd: row.trim_end,
    privacy: row.privacy,
    hasPassword: !!row.password_hash,
    expiresAt: row.expires_at,
    allowDownload: !!row.allow_download,
    allowComments: !!row.allow_comments,
    notify: !!row.notify,
    ctaLabel: row.cta_label ?? '',
    ctaUrl: row.cta_url ?? '',
    ctaMode: row.cta_mode,
    transcript: parseJson<RecSegment[]>(row.transcript, []),
    transcriptStatus: row.transcript_status,
    transcriptError: row.transcript_error,
    summary: row.summary,
    hasThumb: !!row.thumb_url,
    hasGif: !!row.gif_url,
    views: row.views,
    lastViewedAt: row.last_viewed_at,
    createdBy: row.created_by,
    authorName: row.author_name ?? '',
    canManage: actor ? canManage(actor, row) : false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Acceso
// ============================================================

/** Ve el video en la app: quien lo grabó, todo el workspace si está en el espacio compartido, y los admins. */
export function canSee(a: RecActor, v: Pick<RecVideoRow, 'workspace_id' | 'created_by' | 'space'>): boolean {
  if (v.workspace_id !== a.ws) return false;
  return v.created_by === a.actor || v.space === 'workspace' || a.admin;
}

/** Edita, mueve y borra: quien lo grabó o un admin. */
export function canManage(a: RecActor, v: Pick<RecVideoRow, 'workspace_id' | 'created_by'>): boolean {
  return v.workspace_id === a.ws && (v.created_by === a.actor || a.admin);
}

function canSeeFolder(a: RecActor, f: RecFolderRow): boolean {
  return f.workspace_id === a.ws && (f.space === 'workspace' || f.created_by === a.actor);
}

const SELECT_VIDEO = `SELECT v.*, COALESCE(u.name, u.email, '') AS author_name FROM rec_videos v LEFT JOIN users u ON u.id = v.created_by`;

async function rawVideo(id: string): Promise<(RecVideoRow & { author_name: string | null }) | null> {
  return ((await getDb().prepare(`${SELECT_VIDEO} WHERE v.id = ?`).get(id)) as (RecVideoRow & { author_name: string | null }) | undefined) ?? null;
}

export async function getVideoRow(a: RecActor, id: string): Promise<(RecVideoRow & { author_name: string | null }) | null> {
  const v = await rawVideo(id);
  return v && canSee(a, v) ? v : null;
}

async function manageable(a: RecActor, id: string): Promise<RecVideoRow> {
  const v = await rawVideo(id);
  if (!v || !canSee(a, v)) throw new RecError('not_found', 404);
  if (!canManage(a, v)) throw new RecError('forbidden', 403);
  return v;
}

// ============================================================
// Carpetas
// ============================================================

export async function listFolders(a: RecActor): Promise<RecFolderRow[]> {
  return (await getDb()
    .prepare(
      `SELECT * FROM rec_folders WHERE workspace_id = ? AND (space = 'workspace' OR created_by = ?)
       ORDER BY space DESC, name COLLATE NOCASE LIMIT 500`,
    )
    .all(a.ws, a.actor)) as RecFolderRow[];
}

export async function getFolder(a: RecActor, id: string): Promise<RecFolderRow | null> {
  const f = (await getDb().prepare('SELECT * FROM rec_folders WHERE id = ?').get(id)) as RecFolderRow | undefined;
  return f && canSeeFolder(a, f) ? f : null;
}

function cleanName(name: string): string {
  const n = String(name ?? '').trim().slice(0, 120);
  if (!n) throw new RecError('invalid_name');
  return n;
}

export async function createFolder(a: RecActor, input: { name: string; space: RecSpace }): Promise<RecFolderRow> {
  const id = crypto.randomUUID();
  const space: RecSpace = input.space === 'workspace' ? 'workspace' : 'personal';
  await getDb()
    .prepare('INSERT INTO rec_folders (id, workspace_id, space, name, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(id, a.ws, space, cleanName(input.name), a.actor);
  return (await getFolder(a, id))!;
}

function canManageFolder(a: RecActor, f: RecFolderRow): boolean {
  return f.created_by === a.actor || a.admin || (f.space === 'workspace' && a.admin);
}

export async function renameFolder(a: RecActor, id: string, name: string): Promise<RecFolderRow> {
  const f = await getFolder(a, id);
  if (!f) throw new RecError('not_found', 404);
  if (!canManageFolder(a, f)) throw new RecError('forbidden', 403);
  await getDb().prepare("UPDATE rec_folders SET name = ?, updated_at = datetime('now') WHERE id = ?").run(cleanName(name), id);
  return (await getFolder(a, id))!;
}

/** Borra la carpeta; sus videos quedan en la raíz del mismo espacio. */
export async function deleteFolder(a: RecActor, id: string): Promise<void> {
  const f = await getFolder(a, id);
  if (!f) throw new RecError('not_found', 404);
  if (!canManageFolder(a, f)) throw new RecError('forbidden', 403);
  await getDb().prepare('UPDATE rec_videos SET folder_id = NULL WHERE folder_id = ?').run(id);
  await getDb().prepare('DELETE FROM rec_folders WHERE id = ?').run(id);
}

// ============================================================
// Videos: lista
// ============================================================

export interface RecListItem {
  id: string;
  shareId: string;
  title: string;
  status: RecVideoRow['status'];
  space: RecSpace;
  folderId: string | null;
  durationSec: number;
  trimStart: number;
  trimEnd: number | null;
  views: number;
  uniqueViewers: number;
  comments: number;
  hasThumb: boolean;
  hasGif: boolean;
  createdBy: string;
  authorName: string;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RecScope = { kind: 'mine' } | { kind: 'workspace' } | { kind: 'folder'; folderId: string } | { kind: 'all' };

export async function listVideos(a: RecActor, scope: RecScope, q = ''): Promise<RecListItem[]> {
  const where: string[] = ['v.workspace_id = ?'];
  const args: Array<string | number> = [a.ws];
  if (scope.kind === 'mine') {
    where.push("v.created_by = ? AND v.space = 'personal'");
    args.push(a.actor);
  } else if (scope.kind === 'workspace') {
    where.push("v.space = 'workspace'");
  } else if (scope.kind === 'folder') {
    where.push('v.folder_id = ?');
    args.push(scope.folderId);
    where.push("(v.space = 'workspace' OR v.created_by = ?)");
    args.push(a.actor);
  } else {
    where.push(a.admin ? '1 = 1' : "(v.space = 'workspace' OR v.created_by = ?)");
    if (!a.admin) args.push(a.actor);
  }
  if (scope.kind === 'mine' || scope.kind === 'workspace') {
    // En la raíz del espacio solo los que no están en una carpeta.
    where.push('v.folder_id IS NULL');
  }
  const needle = q.trim();
  if (needle) {
    where.push("(v.title LIKE ? ESCAPE '\\' OR v.description LIKE ? ESCAPE '\\' OR v.transcript LIKE ? ESCAPE '\\')");
    const like = `%${needle.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    args.push(like, like, like);
  }
  const rows = (await getDb()
    .prepare(
      `SELECT v.id, v.share_id, v.title, v.status, v.space, v.folder_id, v.duration_sec, v.trim_start, v.trim_end, v.views,
              v.thumb_url, v.gif_url, v.created_by, v.workspace_id, v.created_at, v.updated_at,
              COALESCE(u.name, u.email, '') AS author_name,
              (SELECT COUNT(DISTINCT viewer_key) FROM rec_views w WHERE w.video_id = v.id) AS unique_viewers,
              (SELECT COUNT(*) FROM rec_comments c WHERE c.video_id = v.id AND c.kind = 'comment') AS comments
       FROM rec_videos v LEFT JOIN users u ON u.id = v.created_by
       WHERE ${where.join(' AND ')} AND v.status = 'ready'
       ORDER BY v.created_at DESC LIMIT 500`,
    )
    .all(...args)) as Array<
    Pick<RecVideoRow, 'id' | 'share_id' | 'title' | 'status' | 'space' | 'folder_id' | 'duration_sec' | 'trim_start' | 'trim_end' | 'views' | 'thumb_url' | 'gif_url' | 'created_by' | 'workspace_id' | 'created_at' | 'updated_at'> & {
      author_name: string;
      unique_viewers: number;
      comments: number;
    }
  >;
  return rows.map((r) => ({
    id: r.id,
    shareId: r.share_id,
    title: r.title,
    status: r.status,
    space: r.space,
    folderId: r.folder_id,
    durationSec: r.duration_sec,
    trimStart: r.trim_start,
    trimEnd: r.trim_end,
    views: r.views,
    uniqueViewers: Number(r.unique_viewers) || 0,
    comments: Number(r.comments) || 0,
    hasThumb: !!r.thumb_url,
    hasGif: !!r.gif_url,
    createdBy: r.created_by,
    authorName: r.author_name,
    canManage: canManage(a, r),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** Videos y carpetas para ⌘K, con el mismo alcance que la biblioteca. */
export async function searchRec(a: RecActor, q: string, limit = 6): Promise<Array<{ id: string; kind: 'video' | 'folder'; label: string; meta: string }>> {
  const needle = q.trim();
  if (!needle) return [];
  const like = `%${needle.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const vids = (await getDb()
    .prepare(
      `SELECT id, title AS label, duration_sec FROM rec_videos
       WHERE workspace_id = ? AND status = 'ready' AND (space = 'workspace' OR created_by = ?) AND title LIKE ? ESCAPE '\\'
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(a.ws, a.actor, like, limit)
    .catch(() => [])) as Array<{ id: string; label: string; duration_sec: number }>;
  const folders = (await getDb()
    .prepare(
      `SELECT id, name AS label FROM rec_folders WHERE workspace_id = ? AND (space = 'workspace' OR created_by = ?) AND name LIKE ? ESCAPE '\\'
       ORDER BY name LIMIT ?`,
    )
    .all(a.ws, a.actor, like, limit)
    .catch(() => [])) as Array<{ id: string; label: string }>;
  const { fmtClock } = await import('./rec-schema');
  return [
    ...vids.map((v) => ({ id: v.id, kind: 'video' as const, label: v.label, meta: v.duration_sec ? fmtClock(v.duration_sec) : '' })),
    ...folders.map((f) => ({ id: f.id, kind: 'folder' as const, label: f.label, meta: '' })),
  ];
}

// ============================================================
// Videos: crear, editar, borrar
// ============================================================

export async function createVideo(
  a: RecActor,
  input: { title: string; mode: RecMode; contentType: string; folderId?: string | null; space?: RecSpace },
): Promise<RecVideoRow> {
  let folderId: string | null = null;
  let space: RecSpace = input.space === 'workspace' ? 'workspace' : 'personal';
  if (input.folderId) {
    const f = await getFolder(a, input.folderId);
    if (!f) throw new RecError('invalid_folder');
    folderId = f.id;
    space = f.space;
  }
  const id = crypto.randomUUID();
  const mode: RecMode = (['screen_camera', 'screen', 'camera'] as const).includes(input.mode) ? input.mode : 'screen_camera';
  await getDb()
    .prepare(
      `INSERT INTO rec_videos (id, workspace_id, created_by, share_id, title, mode, content_type, folder_id, space)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, a.ws, a.actor, newShareId(), (input.title.trim() || 'Video').slice(0, 200), mode, input.contentType.split(';')[0].slice(0, 40) || 'video/webm', folderId, space);
  return (await rawVideo(id))!;
}

export interface RecVideoPatch {
  title?: string;
  description?: string;
  summary?: string;
  chaptersText?: string;
  folderId?: string | null;
  space?: RecSpace;
  privacy?: RecPrivacy;
  password?: string | null;
  expiresAt?: string | null;
  allowDownload?: boolean;
  allowComments?: boolean;
  notify?: boolean;
  ctaLabel?: string;
  ctaUrl?: string;
  ctaMode?: RecCtaMode;
  trimStart?: number;
  trimEnd?: number | null;
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(pw, salt, 32);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [kind, salt, hex] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hex) return false;
  const key = await scrypt(pw, salt, 32);
  const want = Buffer.from(hex, 'hex');
  return want.length === key.length && timingSafeEqual(want, key);
}

export async function updateVideo(a: RecActor, id: string, patch: RecVideoPatch): Promise<RecVideoRow> {
  const v = await manageable(a, id);
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  const set = (col: string, val: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  if (patch.title !== undefined) {
    const t = patch.title.trim().slice(0, 200);
    if (!t) throw new RecError('invalid_title');
    set('title', t);
    set('title_source', 'user');
  }
  if (patch.description !== undefined) set('description', patch.description.trim().slice(0, 5000));
  if (patch.summary !== undefined) set('summary', patch.summary.trim().slice(0, 5000));
  if (patch.chaptersText !== undefined) {
    const ch = parseChapters(patch.chaptersText, v.duration_sec > 0 ? v.duration_sec : Infinity);
    set('chapters', JSON.stringify(ch));
    set('chapters_source', 'user');
  }
  if (patch.folderId !== undefined || patch.space !== undefined) {
    if (patch.folderId) {
      const f = await getFolder(a, patch.folderId);
      if (!f) throw new RecError('invalid_folder');
      set('folder_id', f.id);
      set('space', f.space);
    } else {
      set('folder_id', null);
      set('space', patch.space === 'workspace' ? 'workspace' : patch.space === 'personal' ? 'personal' : v.space);
    }
  }
  if (patch.privacy !== undefined) set('privacy', patch.privacy === 'workspace' ? 'workspace' : 'link');
  if (patch.password !== undefined) {
    if (patch.password === null || patch.password === '') set('password_hash', null);
    else {
      if (patch.password.length < 4 || patch.password.length > 200) throw new RecError('invalid_password');
      set('password_hash', await hashPassword(patch.password));
    }
  }
  if (patch.expiresAt !== undefined) {
    if (patch.expiresAt === null || patch.expiresAt === '') set('expires_at', null);
    else {
      const d = new Date(patch.expiresAt);
      if (Number.isNaN(d.getTime())) throw new RecError('invalid_expiry');
      set('expires_at', d.toISOString().slice(0, 19).replace('T', ' '));
    }
  }
  if (patch.allowDownload !== undefined) set('allow_download', patch.allowDownload ? 1 : 0);
  if (patch.allowComments !== undefined) set('allow_comments', patch.allowComments ? 1 : 0);
  if (patch.notify !== undefined) set('notify', patch.notify ? 1 : 0);
  if (patch.ctaLabel !== undefined || patch.ctaUrl !== undefined) {
    const label = (patch.ctaLabel ?? v.cta_label ?? '').trim().slice(0, 60);
    const rawUrl = (patch.ctaUrl ?? v.cta_url ?? '').trim();
    if (!label && !rawUrl) {
      set('cta_label', null);
      set('cta_url', null);
    } else {
      const url = cleanCtaUrl(rawUrl);
      if (!url) throw new RecError('invalid_cta_url');
      if (!label) throw new RecError('invalid_cta_label');
      set('cta_label', label);
      set('cta_url', url);
    }
  }
  if (patch.ctaMode !== undefined) set('cta_mode', patch.ctaMode === 'end' ? 'end' : 'always');
  if (patch.trimStart !== undefined || patch.trimEnd !== undefined) {
    const t = clampTrim(patch.trimStart ?? v.trim_start, patch.trimEnd === undefined ? v.trim_end : patch.trimEnd, v.duration_sec);
    set('trim_start', t.start);
    set('trim_end', t.end);
  }
  if (sets.length) {
    await getDb()
      .prepare(`UPDATE rec_videos SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...args, id);
  }
  return (await rawVideo(id))!;
}

export async function deleteVideo(a: RecActor, id: string): Promise<void> {
  const v = await manageable(a, id);
  await getDb().prepare('DELETE FROM rec_videos WHERE id = ?').run(id);
  const { deleteRecParts } = await import('./rec-upload');
  await deleteRecParts(id).catch(() => undefined);
  await deleteUploads([v.url, v.audio_url, v.thumb_url, v.gif_url].filter((u): u is string => !!u));
}

/** Grabación cerrada: duración y tamaño; pasa a lista y queda en cola para transcribir. */
export async function finalizeVideo(
  a: RecActor,
  id: string,
  input: { durationSec: number; width?: number; height?: number },
): Promise<RecVideoRow> {
  const v = await manageable(a, id);
  if (!v.url) throw new RecError('upload_incomplete', 409);
  const duration = Math.max(0, Math.min(Number(input.durationSec) || 0, 12 * 3600));
  const status: RecTranscriptStatus = v.audio_url || v.url ? 'pending' : 'none';
  await getDb()
    .prepare(
      `UPDATE rec_videos SET status = 'ready', duration_sec = ?, width = ?, height = ?, transcript_status = ?,
       updated_at = datetime('now') WHERE id = ? AND status != 'ready'`,
    )
    .run(duration, Math.max(0, Math.round(Number(input.width) || 0)), Math.max(0, Math.round(Number(input.height) || 0)), status, id);
  return (await rawVideo(id))!;
}

/** Volver a transcribir (después de configurar la IA o de un error). */
export async function requeueTranscript(a: RecActor, id: string): Promise<RecVideoRow> {
  const v = await manageable(a, id);
  if (v.status !== 'ready') throw new RecError('not_ready', 409);
  await getDb()
    .prepare("UPDATE rec_videos SET transcript_status = 'pending', transcript_error = NULL, processing_at = NULL WHERE id = ?")
    .run(id);
  return (await rawVideo(id))!;
}

export async function setVideoFile(id: string, kind: 'video' | 'audio' | 'thumb' | 'gif', url: string, extra: { size?: number; contentType?: string } = {}): Promise<void> {
  const col = kind === 'video' ? 'url' : kind === 'audio' ? 'audio_url' : kind === 'thumb' ? 'thumb_url' : 'gif_url';
  const prev = (await getDb().prepare(`SELECT ${col} AS u FROM rec_videos WHERE id = ?`).get(id)) as { u: string | null } | undefined;
  if (kind === 'video') {
    await getDb()
      .prepare("UPDATE rec_videos SET url = ?, size = ?, content_type = COALESCE(?, content_type), updated_at = datetime('now') WHERE id = ?")
      .run(url, Math.max(0, Math.round(extra.size ?? 0)), extra.contentType ?? null, id);
  } else {
    await getDb().prepare(`UPDATE rec_videos SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`).run(url, id);
  }
  if (prev?.u && prev.u !== url) await deleteUploads([prev.u]).catch(() => undefined);
}

export { manageable as getManageableVideo };

// ============================================================
// Página pública
// ============================================================

export async function getPublicVideoRow(shareId: string): Promise<(RecVideoRow & { author_name: string | null }) | null> {
  if (!/^[\w-]{8,40}$/.test(shareId)) return null;
  const v = (await getDb().prepare(`${SELECT_VIDEO} WHERE v.share_id = ?`).get(shareId)) as (RecVideoRow & { author_name: string | null }) | undefined;
  return v && v.status === 'ready' && v.url ? v : null;
}

export function unlockCookieName(shareId: string): string {
  return `rec_pw_${shareId}`;
}

/** Valor de la cookie de desbloqueo: cambia si cambia la contraseña. */
export function unlockToken(v: Pick<RecVideoRow, 'share_id' | 'password_hash'>): string {
  return createHmac('sha256', process.env.NEXTAUTH_SECRET ?? 'rec').update(`${v.share_id}:${v.password_hash ?? ''}`).digest('base64url');
}

export type PublicAccess = 'ok' | 'expired' | 'password' | 'signin' | 'forbidden';

/**
 * ¿Puede ver este video quien abrió el link? `viewerWs` es el workspace de la
 * sesión (null sin login) y `unlock` el valor de la cookie de la contraseña.
 * El autor y su workspace siempre pueden (vencido incluido, para revisarlo).
 */
export function publicAccess(
  v: Pick<RecVideoRow, 'workspace_id' | 'share_id' | 'password_hash' | 'expires_at' | 'privacy'>,
  viewerWs: string | null,
  unlock: string | null,
  now = Date.now(),
): PublicAccess {
  const member = viewerWs === v.workspace_id;
  if (member) return 'ok';
  if (v.expires_at && dbTime(v.expires_at) <= now) return 'expired';
  if (v.privacy === 'workspace') return viewerWs ? 'forbidden' : 'signin';
  if (v.password_hash) {
    const want = unlockToken(v);
    if (!unlock || unlock.length !== want.length || !timingSafeEqual(Buffer.from(unlock), Buffer.from(want))) return 'password';
  }
  return 'ok';
}

export interface PublicVideoDto {
  shareId: string;
  title: string;
  description: string;
  chapters: RecChapter[];
  authorName: string;
  createdAt: string;
  durationSec: number;
  trimStart: number;
  trimEnd: number | null;
  contentType: string;
  transcript: RecSegment[];
  summary: string;
  allowDownload: boolean;
  allowComments: boolean;
  ctaLabel: string;
  ctaUrl: string;
  ctaMode: RecCtaMode;
  hasThumb: boolean;
}

export function toPublicDto(v: RecVideoRow & { author_name: string | null }): PublicVideoDto {
  return {
    shareId: v.share_id,
    title: v.title,
    description: v.description,
    chapters: normalizeChapters(parseJson<RecChapter[]>(v.chapters, [])),
    authorName: v.author_name ?? '',
    createdAt: v.created_at,
    durationSec: v.duration_sec,
    trimStart: v.trim_start,
    trimEnd: v.trim_end,
    contentType: v.content_type,
    transcript: parseJson<RecSegment[]>(v.transcript, []),
    summary: v.summary,
    allowDownload: !!v.allow_download,
    allowComments: !!v.allow_comments,
    ctaLabel: v.cta_label ?? '',
    ctaUrl: v.cta_url ?? '',
    ctaMode: v.cta_mode,
    hasThumb: !!v.thumb_url,
  };
}

// ============================================================
// Vistas
// ============================================================

export interface RecViewer {
  /** Clave estable del espectador: "u:<id>" logueado o la cookie anónima. */
  key: string;
  userId: string | null;
  name: string;
  /** El autor mirando su propio video: no cuenta (como Loom). */
  isAuthor: boolean;
}

async function notifyAuthor(v: RecVideoRow, type: 'rec_view' | 'rec_comment', title: string, meta: Record<string, string>): Promise<void> {
  if (!v.notify) return;
  try {
    const { createNotification } = await import('./notifications');
    await createNotification({ userId: v.created_by, type, title, href: `/app/rec/${v.id}`, sourceType: 'rec_video', sourceId: v.id, meta: { ...meta, title: v.title } });
  } catch {
    /* el aviso no corta la vista ni el comentario */
  }
}

export async function trackRecView(
  v: RecVideoRow,
  viewer: RecViewer,
  input: { viewId?: string; watched?: number; position?: number; duration?: number; cta?: boolean; ip?: string; userAgent?: string },
): Promise<{ viewId: string | null }> {
  if (viewer.isAuthor) return { viewId: null };
  const db = getDb();
  const visible = trimmedDuration(v.duration_sec, v.trim_start, v.trim_end);
  const duration = Math.max(0, Math.min(Number(input.duration) || visible, 12 * 3600));
  if (input.viewId) {
    const view = (await db.prepare('SELECT * FROM rec_views WHERE id = ? AND video_id = ? AND viewer_key = ?').get(input.viewId, v.id, viewer.key)) as
      | { id: string; watched_sec: number; max_position: number; last_ping_at: string; cta_clicks: number }
      | undefined;
    if (!view) return { viewId: null };
    const elapsed = (Date.now() - dbTime(view.last_ping_at)) / 1000;
    const target = Math.max(view.watched_sec, Number(input.watched) || 0);
    const watched = Math.min(target, view.watched_sec + Math.max(60, Math.ceil(elapsed) + 5));
    const maxPos = Math.max(view.max_position, Math.min(Number(input.position) || 0, duration || Number.MAX_SAFE_INTEGER));
    await db
      .prepare('UPDATE rec_views SET watched_sec = ?, max_position = ?, duration_sec = ?, cta_clicks = cta_clicks + ?, last_ping_at = ? WHERE id = ?')
      .run(watched, maxPos, duration, input.cta ? 1 : 0, nowDb(), view.id);
    return { viewId: view.id };
  }
  const first = !(await db.prepare('SELECT 1 FROM rec_views WHERE video_id = ? AND viewer_key = ? LIMIT 1').get(v.id, viewer.key));
  const id = crypto.randomUUID();
  const ts = nowDb();
  await db
    .prepare(
      `INSERT INTO rec_views (id, video_id, workspace_id, viewer_key, user_id, viewer_name, duration_sec, cta_clicks, ip_hash, user_agent, started_at, last_ping_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, v.id, v.workspace_id, viewer.key, viewer.userId, viewer.name.slice(0, 120), duration, input.cta ? 1 : 0, hashIp(input.ip ?? ''), (input.userAgent ?? '').slice(0, 300), ts, ts);
  await db.prepare('UPDATE rec_videos SET views = views + 1, last_viewed_at = ? WHERE id = ?').run(ts, v.id);
  if (first) await notifyAuthor(v, 'rec_view', `${viewer.name || 'Someone'} watched "${v.title}"`, viewer.name ? { actorName: viewer.name } : {});
  return { viewId: id };
}

export interface RecViewerRow {
  viewerKey: string;
  name: string;
  signedIn: boolean;
  views: number;
  watchedSec: number;
  pct: number;
  ctaClicks: number;
  lastAt: string;
}

export interface RecAnalytics {
  views: number;
  unique: number;
  avgPct: number;
  completed: number;
  ctaClicks: number;
  viewers: RecViewerRow[];
}

export async function getAnalytics(a: RecActor, id: string): Promise<RecAnalytics> {
  const v = await getVideoRow(a, id);
  if (!v) throw new RecError('not_found', 404);
  const rows = (await getDb()
    .prepare(
      `SELECT viewer_key, user_id, viewer_name, watched_sec, max_position, duration_sec, cta_clicks, started_at
       FROM rec_views WHERE video_id = ? ORDER BY started_at DESC LIMIT 5000`,
    )
    .all(id)) as Array<{ viewer_key: string; user_id: string | null; viewer_name: string; watched_sec: number; max_position: number; duration_sec: number; cta_clicks: number; started_at: string }>;
  const visible = trimmedDuration(v.duration_sec, v.trim_start, v.trim_end);
  const stats = viewStats(rows, visible);
  const by = new Map<string, RecViewerRow>();
  for (const r of rows) {
    const d = r.duration_sec > 0 ? r.duration_sec : visible;
    const cur = by.get(r.viewer_key);
    const pct = viewPct(r.max_position, d);
    if (!cur) {
      by.set(r.viewer_key, {
        viewerKey: r.viewer_key,
        name: r.viewer_name,
        signedIn: !!r.user_id,
        views: 1,
        watchedSec: r.watched_sec,
        pct,
        ctaClicks: r.cta_clicks,
        lastAt: r.started_at,
      });
    } else {
      cur.views++;
      cur.watchedSec += r.watched_sec;
      cur.pct = Math.max(cur.pct, pct);
      cur.ctaClicks += r.cta_clicks;
      if (!cur.name && r.viewer_name) cur.name = r.viewer_name;
    }
  }
  return { ...stats, viewers: [...by.values()] };
}

// ============================================================
// Comentarios y reacciones
// ============================================================

export interface RecCommentDto {
  id: string;
  parentId: string | null;
  kind: 'comment' | 'reaction';
  body: string;
  emoji: string | null;
  atSec: number | null;
  authorName: string;
  mine: boolean;
  createdAt: string;
}

export async function listComments(videoId: string, viewerKey: string | null): Promise<RecCommentDto[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM rec_comments WHERE video_id = ? ORDER BY created_at ASC LIMIT 2000')
    .all(videoId)) as Array<{ id: string; parent_id: string | null; kind: 'comment' | 'reaction'; body: string; emoji: string | null; at_sec: number | null; author_name: string; viewer_key: string; created_at: string }>;
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    kind: r.kind,
    body: r.body,
    emoji: r.emoji,
    atSec: r.at_sec,
    authorName: r.author_name,
    mine: !!viewerKey && r.viewer_key === viewerKey,
    createdAt: r.created_at,
  }));
}

export async function addComment(
  v: RecVideoRow,
  viewer: RecViewer,
  input: { kind: 'comment' | 'reaction'; body?: string; emoji?: string; atSec?: number | null; parentId?: string | null },
): Promise<RecCommentDto> {
  if (!v.allow_comments) throw new RecError('comments_off', 403);
  const { REC_REACTIONS } = await import('./rec-schema');
  const kind = input.kind === 'reaction' ? 'reaction' : 'comment';
  const body = kind === 'comment' ? String(input.body ?? '').trim().slice(0, 4000) : '';
  const emoji = kind === 'reaction' ? String(input.emoji ?? '') : null;
  if (kind === 'comment' && !body) throw new RecError('empty_comment');
  if (kind === 'reaction' && !(REC_REACTIONS as readonly string[]).includes(emoji ?? '')) throw new RecError('invalid_reaction');
  const name = viewer.name.trim().slice(0, 80);
  if (!name) throw new RecError('name_required');
  let parentId: string | null = null;
  if (input.parentId) {
    const p = (await getDb().prepare("SELECT id FROM rec_comments WHERE id = ? AND video_id = ? AND kind = 'comment' AND parent_id IS NULL").get(input.parentId, v.id)) as { id: string } | undefined;
    if (!p) throw new RecError('invalid_parent');
    parentId = p.id;
  }
  const at = input.atSec === null || input.atSec === undefined || parentId ? null : Math.max(0, Math.min(Number(input.atSec) || 0, Math.max(v.duration_sec, 0) || 12 * 3600));
  const id = crypto.randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO rec_comments (id, video_id, workspace_id, parent_id, kind, body, emoji, at_sec, user_id, author_name, viewer_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, v.id, v.workspace_id, parentId, kind, body, emoji, at === null ? null : Math.round(at * 10) / 10, viewer.userId, name, viewer.key);
  if (!viewer.isAuthor) {
    await notifyAuthor(
      v,
      'rec_comment',
      kind === 'comment' ? `${name} commented on "${v.title}": ${body.slice(0, 80)}` : `${name} reacted ${emoji} to "${v.title}"`,
      kind === 'comment' ? { actorName: name } : { actorName: name, emoji: emoji ?? '' },
    );
  }
  return (await listComments(v.id, viewer.key)).find((c) => c.id === id)!;
}

/** Borrar un comentario: quien lo escribió (misma clave de espectador) o quien administra el video. */
export async function deleteComment(v: RecVideoRow, commentId: string, viewer: RecViewer, actor: RecActor | null): Promise<void> {
  const c = (await getDb().prepare('SELECT viewer_key FROM rec_comments WHERE id = ? AND video_id = ?').get(commentId, v.id)) as { viewer_key: string } | undefined;
  if (!c) throw new RecError('not_found', 404);
  const allowed = c.viewer_key === viewer.key || (actor !== null && canManage(actor, v));
  if (!allowed) throw new RecError('forbidden', 403);
  await getDb().prepare('DELETE FROM rec_comments WHERE id = ? OR parent_id = ?').run(commentId, commentId);
}

export { normalizeChapters };

/**
 * Grabaciones que nunca se cerraron (pestaña cerrada a mitad, subida caída):
 * a las 24 h se borran con sus partes. Lo corre el cron de cada minuto.
 */
export async function cleanupStaleRecordings(limit = 20): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  const rows = (await getDb()
    .prepare("SELECT id, url, audio_url, thumb_url, gif_url FROM rec_videos WHERE status = 'recording' AND created_at < ? LIMIT ?")
    .all(cutoff, limit)) as Array<Pick<RecVideoRow, 'id' | 'url' | 'audio_url' | 'thumb_url' | 'gif_url'>>;
  const { deleteRecParts } = await import('./rec-upload');
  for (const r of rows) {
    const res = await getDb().prepare("DELETE FROM rec_videos WHERE id = ? AND status = 'recording'").run(r.id);
    if (!res.changes) continue;
    await deleteRecParts(r.id).catch(() => undefined);
    await deleteUploads([r.url, r.audio_url, r.thumb_url, r.gif_url].filter((u): u is string => !!u));
  }
  return rows.length;
}
