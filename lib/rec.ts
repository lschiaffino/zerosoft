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
import { ensureMigrated, getClient, getDb, txDb } from './db';
import { deleteUploads } from './uploads';
import {
  chaptersInTrim,
  chaptersToText,
  cleanEmails,
  cleanOverlays,
  MAX_REC_ALLOWED,
  overlaysInTrim,
  remapChapters,
  remapSegments,
  type RecEditPiece,
  type RecOverlay,
  coveredPct,
  isTrimmed,
  mergeRanges,
  retentionCurve,
  segmentsInTrim,
  trimKey,
  type Range,
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

/**
 * Borra archivos de Rec. Si Blob falla, la URL queda en cola y el cron reintenta:
 * un archivo de un video borrado no puede quedar leíble por un error de red.
 */
export async function dropRecFiles(urls: string[]): Promise<void> {
  const blobs = urls.filter((u) => /^https:\/\//.test(u));
  const local = urls.filter((u) => !/^https:\/\//.test(u));
  if (local.length) await deleteUploads(local);
  if (!blobs.length || !process.env.BLOB_READ_WRITE_TOKEN) return;
  const { del } = await import('@vercel/blob');
  try {
    await del(blobs);
  } catch {
    for (const u of blobs) await getDb().prepare('INSERT OR IGNORE INTO rec_file_deletes (url) VALUES (?)').run(u).catch(() => undefined);
  }
}

/** Cron: reintenta lo que Blob no pudo borrar. Hasta 20 intentos por archivo. */
export async function retryRecFileDeletes(limit = 20): Promise<number> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return 0;
  const rows = (await getDb().prepare('SELECT url FROM rec_file_deletes ORDER BY attempts LIMIT ?').all(limit)) as Array<{ url: string }>;
  if (!rows.length) return 0;
  const { del } = await import('@vercel/blob');
  let done = 0;
  for (const r of rows) {
    try {
      await del(r.url);
      await getDb().prepare('DELETE FROM rec_file_deletes WHERE url = ?').run(r.url);
      done++;
    } catch {
      await getDb().prepare('UPDATE rec_file_deletes SET attempts = attempts + 1 WHERE url = ?').run(r.url);
      await getDb().prepare('DELETE FROM rec_file_deletes WHERE url = ? AND attempts >= 20').run(r.url);
    }
  }
  return done;
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
  space_id?: string | null;
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
  thumb_at: number | null;
  thumb_for: string | null;
  gif_for: string | null;
  duration_sec: number;
  width: number;
  height: number;
  trim_start: number;
  trim_end: number | null;
  /** 'workspace' también guarda el modo de personas puntuales (people_only = 1): la tabla no admite otro valor. */
  privacy: 'link' | 'workspace';
  people_only: number;
  allowed_emails: string;
  require_email: number;
  archived_at: string | null;
  space_id: string | null;
  overlays: string;
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
  summary_source: 'auto' | 'user';
  summary_trim: string | null;
  trimmed_url: string | null;
  trimmed_for: string | null;
  comments_require_account: number;
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
  /** Solo para quien administra el video. */
  allowedEmails: string[];
  requireEmail: boolean;
  archived: boolean;
  spaceId: string | null;
  overlays: RecOverlay[];
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
  /** El resumen corresponde al recorte vigente (o lo escribió la persona). */
  summaryFitsTrim: boolean;
  commentsRequireAccount: boolean;
  /** Si hay recorte, ya existe la copia recortada que ven los demás. */
  trimCut: boolean;
  hasThumb: boolean;
  hasGif: boolean;
  /** Segundo del original de donde sale la miniatura (null = no se sabe). */
  thumbAt: number | null;
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
  const manager = actor ? canManage(actor, row) : false;
  const allChapters = parseJson<RecChapter[]>(row.chapters, []);
  const allSegments = parseJson<RecSegment[]>(row.transcript, []);
  // Quien no puede editar el video ve solo lo que queda dentro del recorte.
  const chapters = manager ? allChapters : chaptersInTrim(allChapters, row.trim_start, row.trim_end);
  const transcript = manager ? allSegments : segmentsInTrim(allSegments, row.trim_start, row.trim_end);
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
    privacy: row.people_only ? 'people' : row.privacy,
    allowedEmails: manager ? parseJson<string[]>(row.allowed_emails, []) : [],
    requireEmail: !!row.require_email,
    archived: !!row.archived_at,
    spaceId: row.space_id ?? null,
    overlays: manager ? parseJson<RecOverlay[]>(row.overlays, []) : overlaysInTrim(parseJson<RecOverlay[]>(row.overlays, []), row.trim_start, row.trim_end),
    hasPassword: !!row.password_hash,
    expiresAt: row.expires_at,
    allowDownload: !!row.allow_download,
    allowComments: !!row.allow_comments,
    notify: !!row.notify,
    ctaLabel: row.cta_label ?? '',
    ctaUrl: row.cta_url ?? '',
    ctaMode: row.cta_mode,
    transcript,
    transcriptStatus: row.transcript_status,
    transcriptError: row.transcript_error,
    summary: manager || summaryFitsTrim(row) ? row.summary : '',
    summaryFitsTrim: summaryFitsTrim(row),
    commentsRequireAccount: !!row.comments_require_account,
    trimCut: !isTrimmed(row.trim_start, row.trim_end) || row.trimmed_for === trimKey(row.trim_start, row.trim_end),
    hasThumb: !!row.thumb_url && (manager || assetVisible(row, 'thumb')),
    hasGif: !!row.gif_url && (manager || assetVisible(row, 'gif')),
    thumbAt: row.thumb_at,
    views: row.views,
    lastViewedAt: row.last_viewed_at,
    createdBy: row.created_by,
    authorName: row.author_name ?? '',
    canManage: manager,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Acceso
// ============================================================

/**
 * Ve el video en la app: quien lo grabó, y todo el workspace si está en el
 * espacio compartido. Lo personal (Mis videos) es solo del autor, como en
 * Loom: ni los admins lo ven ni lo editan.
 */
export function canSee(a: RecActor, v: Pick<RecVideoRow, 'workspace_id' | 'created_by' | 'space'>): boolean {
  if (v.workspace_id !== a.ws) return false;
  return v.created_by === a.actor || v.space === 'workspace';
}

/** Edita, mueve y borra: quien lo grabó; en el espacio del workspace, también un admin. */
export function canManage(a: RecActor, v: Pick<RecVideoRow, 'workspace_id' | 'created_by' | 'space'>): boolean {
  if (v.workspace_id !== a.ws) return false;
  return v.created_by === a.actor || (v.space === 'workspace' && a.admin);
}

/**
 * ¿Se le puede mostrar la miniatura o el GIF a quien no administra el video?
 * Sin recorte, sí. Con recorte: si se armó para ese recorte, o (miniatura) si
 * sale de un cuadro que queda adentro. Si no, se muestra un vacío hasta que el
 * autor los regenere al guardar el recorte.
 */
export function assetVisible(
  v: Pick<RecVideoRow, 'trim_start' | 'trim_end' | 'thumb_at' | 'thumb_for' | 'gif_for'>,
  kind: 'thumb' | 'gif',
): boolean {
  if (!isTrimmed(v.trim_start, v.trim_end)) return true;
  const key = trimKey(v.trim_start, v.trim_end);
  if (kind === 'gif') return v.gif_for === key;
  if (v.thumb_for === key) return true;
  return v.thumb_at !== null && v.thumb_at >= v.trim_start && (v.trim_end === null || v.thumb_at < v.trim_end);
}

export async function setAssetMeta(id: string, kind: 'thumb' | 'gif', forTrim: string | null, atSec: number | null): Promise<void> {
  if (kind === 'gif') await getDb().prepare('UPDATE rec_videos SET gif_for = ? WHERE id = ?').run(forTrim, id);
  else await getDb().prepare('UPDATE rec_videos SET thumb_for = ?, thumb_at = ? WHERE id = ?').run(forTrim, atSec, id);
}

/** El resumen se puede mostrar a otros: lo escribió la persona o se armó para el recorte vigente. */
export function summaryFitsTrim(v: Pick<RecVideoRow, 'summary_source' | 'summary_trim' | 'trim_start' | 'trim_end'>): boolean {
  if (v.summary_source === 'user' || !isTrimmed(v.trim_start, v.trim_end)) return true;
  return v.summary_trim === trimKey(v.trim_start, v.trim_end);
}

function canSeeFolder(a: RecActor, f: RecFolderRow): boolean {
  return f.workspace_id === a.ws && (f.space === 'workspace' || f.created_by === a.actor);
}

/** Todo o nada. */
export async function inTx<T>(fn: (t: ReturnType<typeof txDb>) => Promise<T>): Promise<T> {
  await ensureMigrated();
  const tx = await getClient().transaction('write');
  try {
    const out = await fn(txDb(tx));
    await tx.commit();
    return out;
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  } finally {
    tx.close();
  }
}

/** ¿Esta persona es miembro del espacio? Los admins entran a todos los del workspace. */
export async function isSpaceMember(spaceId: string, userId: string): Promise<boolean> {
  return !!(await getDb().prepare('SELECT 1 FROM rec_space_members WHERE space_id = ? AND user_id = ?').get(spaceId, userId));
}

async function canEnterSpace(a: RecActor, spaceId: string | null | undefined): Promise<boolean> {
  if (!spaceId || a.admin) return true;
  return isSpaceMember(spaceId, a.actor);
}

/**
 * SQL de lo que esta persona ve en la biblioteca: lo suyo, y lo del workspace
 * salvo los espacios de los que no es miembro. Todo listado pasa por acá.
 */
function visibleSql(alias: string, a: RecActor): { sql: string; args: Array<string | number> } {
  const t = alias ? `${alias}.` : '';
  return {
    sql: `(${t}created_by = ? OR (${t}space = 'workspace' AND (${t}space_id IS NULL OR ? = 1 OR ${t}space_id IN (SELECT space_id FROM rec_space_members WHERE user_id = ?))))`,
    args: [a.actor, a.admin ? 1 : 0, a.actor],
  };
}

const SELECT_VIDEO = `SELECT v.*, COALESCE(u.name, u.email, '') AS author_name FROM rec_videos v LEFT JOIN users u ON u.id = v.created_by`;

async function rawVideo(id: string): Promise<(RecVideoRow & { author_name: string | null }) | null> {
  return ((await getDb().prepare(`${SELECT_VIDEO} WHERE v.id = ?`).get(id)) as (RecVideoRow & { author_name: string | null }) | undefined) ?? null;
}

export async function getVideoRow(a: RecActor, id: string): Promise<(RecVideoRow & { author_name: string | null }) | null> {
  const v = await rawVideo(id);
  if (!v || !canSee(a, v)) return null;
  if (v.created_by !== a.actor && !(await canEnterSpace(a, v.space_id))) return null;
  return v;
}

async function manageable(a: RecActor, id: string): Promise<RecVideoRow> {
  const v = await getVideoRow(a, id);
  if (!v) throw new RecError('not_found', 404);
  if (!canManage(a, v)) throw new RecError('forbidden', 403);
  return v;
}

// ============================================================
// Carpetas
// ============================================================

export async function listFolders(a: RecActor): Promise<RecFolderRow[]> {
  const vis = visibleSql('', a);
  return (await getDb()
    .prepare(`SELECT * FROM rec_folders WHERE workspace_id = ? AND ${vis.sql} ORDER BY space DESC, name COLLATE NOCASE LIMIT 500`)
    .all(a.ws, ...vis.args)) as RecFolderRow[];
}

export async function getFolder(a: RecActor, id: string): Promise<RecFolderRow | null> {
  const f = (await getDb().prepare('SELECT * FROM rec_folders WHERE id = ?').get(id)) as RecFolderRow | undefined;
  if (!f || !canSeeFolder(a, f)) return null;
  if (f.created_by !== a.actor && !(await canEnterSpace(a, f.space_id))) return null;
  return f;
}

/** El espacio existe en este workspace y la persona puede entrar. */
async function usableSpace(a: RecActor, spaceId: string): Promise<string> {
  const s = (await getDb().prepare('SELECT id FROM rec_spaces WHERE id = ? AND workspace_id = ?').get(spaceId, a.ws)) as { id: string } | undefined;
  if (!s || !(await canEnterSpace(a, s.id))) throw new RecError('invalid_space');
  return s.id;
}

function cleanName(name: string): string {
  const n = String(name ?? '').trim().slice(0, 120);
  if (!n) throw new RecError('invalid_name');
  return n;
}

export async function createFolder(a: RecActor, input: { name: string; space: RecSpace; spaceId?: string | null }): Promise<RecFolderRow> {
  const id = crypto.randomUUID();
  const spaceId = input.spaceId ? await usableSpace(a, input.spaceId) : null;
  const space: RecSpace = spaceId || input.space === 'workspace' ? 'workspace' : 'personal';
  await getDb()
    .prepare('INSERT INTO rec_folders (id, workspace_id, space, space_id, name, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, a.ws, space, spaceId, cleanName(input.name), a.actor);
  return (await getFolder(a, id))!;
}

function canManageFolder(a: RecActor, f: RecFolderRow): boolean {
  return f.created_by === a.actor || (f.space === 'workspace' && a.admin);
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
  await inTx(async (t) => {
    await t.prepare('UPDATE rec_videos SET folder_id = NULL WHERE folder_id = ?').run(id);
    await t.prepare('DELETE FROM rec_folders WHERE id = ?').run(id);
  });
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
  archived: boolean;
  watchLater: boolean;
  spaceId: string | null;
  privacy: RecPrivacy;
  contentType: string;
  size: number;
  createdBy: string;
  authorName: string;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RecScope =
  | { kind: 'mine' }
  | { kind: 'workspace' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'space'; spaceId: string }
  | { kind: 'archived' }
  | { kind: 'later' }
  | { kind: 'all' };

export async function listVideos(a: RecActor, scope: RecScope, q = ''): Promise<RecListItem[]> {
  const where: string[] = ['v.workspace_id = ?'];
  const args: Array<string | number> = [a.ws];
  // Toda vista respeta lo que la persona puede ver (también carpetas, espacios, archivo y "ver más tarde").
  const vis = visibleSql('v', a);
  where.push(vis.sql);
  args.push(...vis.args);
  if (scope.kind === 'mine') {
    where.push("v.created_by = ? AND v.space = 'personal'");
    args.push(a.actor);
  } else if (scope.kind === 'workspace') {
    where.push("v.space = 'workspace' AND v.space_id IS NULL");
  } else if (scope.kind === 'folder') {
    where.push('v.folder_id = ?');
    args.push(scope.folderId);
  } else if (scope.kind === 'space') {
    where.push('v.space_id = ?');
    args.push(scope.spaceId);
  } else if (scope.kind === 'later') {
    where.push('EXISTS (SELECT 1 FROM rec_watch_later l WHERE l.video_id = v.id AND l.user_id = ?)');
    args.push(a.actor);
  }
  where.push(scope.kind === 'archived' ? 'v.archived_at IS NOT NULL' : 'v.archived_at IS NULL');
  if ((scope.kind === 'mine' || scope.kind === 'workspace' || scope.kind === 'space') && !q.trim()) {
    // En la raíz del espacio solo los que no están en una carpeta (buscando, todo el espacio).
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
              v.archived_at, v.space_id, v.content_type, v.size, v.thumb_url, v.gif_url, v.thumb_at, v.thumb_for, v.gif_for, v.created_by, v.workspace_id, v.created_at, v.updated_at, v.description, v.privacy, v.people_only${needle ? ', v.transcript' : ''},
              COALESCE(u.name, u.email, '') AS author_name,
              EXISTS (SELECT 1 FROM rec_watch_later l WHERE l.video_id = v.id AND l.user_id = ?) AS in_later,
              (SELECT COUNT(DISTINCT viewer_key) FROM rec_views w WHERE w.video_id = v.id) AS unique_viewers,
              (SELECT COUNT(*) FROM rec_comments c WHERE c.video_id = v.id AND c.kind = 'comment') AS comments
       FROM rec_videos v LEFT JOIN users u ON u.id = v.created_by
       WHERE ${where.join(' AND ')} AND v.status = 'ready'
       ORDER BY v.created_at DESC LIMIT 500`,
    )
    .all(a.actor, ...args)) as Array<
    Pick<
      RecVideoRow,
      'id' | 'archived_at' | 'space_id' | 'content_type' | 'size' | 'share_id' | 'title' | 'status' | 'space' | 'folder_id' | 'duration_sec' | 'trim_start' | 'trim_end' | 'views' | 'thumb_url' | 'gif_url' | 'thumb_at' | 'thumb_for' | 'gif_for' | 'created_by' | 'workspace_id' | 'created_at' | 'updated_at' | 'privacy' | 'people_only'
    > & {
      author_name: string;
      in_later: number;
      unique_viewers: number;
      comments: number;
      description: string;
      transcript?: string;
    }
  >;
  return rows.filter((r) => !needle || matchesVisibleText(a, r, needle)).map((r) => ({
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
    hasThumb: !!r.thumb_url && (canManage(a, r) || assetVisible(r, 'thumb')),
    hasGif: !!r.gif_url && (canManage(a, r) || assetVisible(r, 'gif')),
    archived: !!r.archived_at,
    watchLater: !!Number(r.in_later),
    spaceId: r.space_id ?? null,
    privacy: r.people_only ? 'people' : r.privacy,
    contentType: r.content_type,
    size: Number(r.size) || 0,
    createdBy: r.created_by,
    authorName: r.author_name,
    canManage: canManage(a, r),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * ¿Lo buscado aparece en lo que esta persona puede ver? Quien no administra
 * el video no encuentra texto de la parte recortada de la transcripción.
 */
function matchesVisibleText(
  a: RecActor,
  r: Pick<RecVideoRow, 'workspace_id' | 'created_by' | 'space' | 'title' | 'trim_start' | 'trim_end'> & { description?: string; transcript?: string },
  needle: string,
): boolean {
  const n = needle.toLowerCase();
  if (r.title.toLowerCase().includes(n) || (r.description ?? '').toLowerCase().includes(n)) return true;
  const segs = parseJson<RecSegment[]>(r.transcript ?? '[]', []);
  const visible = canManage(a, r) ? segs : segmentsInTrim(segs, r.trim_start, r.trim_end);
  return visible.some((x) => x.text.toLowerCase().includes(n));
}

/** Videos y carpetas para ⌘K, con el mismo alcance que la biblioteca (también en la transcripción). */
export async function searchRec(a: RecActor, q: string, limit = 6): Promise<Array<{ id: string; kind: 'video' | 'folder' | 'space'; label: string; meta: string }>> {
  const needle = q.trim();
  if (!needle) return [];
  const like = `%${needle.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const vis = visibleSql('', a);
  const vids = (await getDb()
    .prepare(
      `SELECT id, title AS label, title, description, transcript, duration_sec, workspace_id, created_by, space, trim_start, trim_end FROM rec_videos
       WHERE workspace_id = ? AND status = 'ready' AND ${vis.sql}
         AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR transcript LIKE ? ESCAPE '\\')
       ORDER BY updated_at DESC LIMIT 40`,
    )
    .all(a.ws, ...vis.args, like, like, like)
    .catch(() => [])) as Array<
    { id: string; label: string; duration_sec: number; description: string; transcript: string } & Pick<
      RecVideoRow,
      'workspace_id' | 'created_by' | 'space' | 'title' | 'trim_start' | 'trim_end'
    >
  >;
  const visible = vids.filter((v) => matchesVisibleText(a, v, needle)).slice(0, limit);
  const folders = (await getDb()
    .prepare(
      `SELECT id, name AS label FROM rec_folders WHERE workspace_id = ? AND ${vis.sql} AND name LIKE ? ESCAPE '\\'
       ORDER BY name LIMIT ?`,
    )
    .all(a.ws, ...vis.args, like, limit)
    .catch(() => [])) as Array<{ id: string; label: string }>;
  const spaces = (await getDb()
    .prepare(
      `SELECT s.id, s.name AS label FROM rec_spaces s WHERE s.workspace_id = ? AND s.name LIKE ? ESCAPE '\\'
         AND (? = 1 OR s.id IN (SELECT space_id FROM rec_space_members WHERE user_id = ?))
       ORDER BY s.name LIMIT ?`,
    )
    .all(a.ws, like, a.admin ? 1 : 0, a.actor, limit)
    .catch(() => [])) as Array<{ id: string; label: string }>;
  const { fmtClock } = await import('./rec-schema');
  return [
    ...visible.map((v) => ({ id: v.id, kind: 'video' as const, label: v.label, meta: v.duration_sec ? fmtClock(v.duration_sec) : '' })),
    ...folders.map((f) => ({ id: f.id, kind: 'folder' as const, label: f.label, meta: '' })),
    ...spaces.map((f) => ({ id: f.id, kind: 'space' as const, label: f.label, meta: '' })),
  ];
}

// ============================================================
// Videos: crear, editar, borrar
// ============================================================

export async function createVideo(
  a: RecActor,
  input: { title: string; mode: RecMode; contentType: string; folderId?: string | null; space?: RecSpace; spaceId?: string | null; titleSource?: 'auto' | 'user' },
): Promise<RecVideoRow> {
  let folderId: string | null = null;
  let space: RecSpace = input.space === 'workspace' ? 'workspace' : 'personal';
  let spaceId: string | null = null;
  if (input.spaceId) {
    spaceId = await usableSpace(a, input.spaceId);
    space = 'workspace';
  }
  if (input.folderId) {
    const f = await getFolder(a, input.folderId);
    if (!f) throw new RecError('invalid_folder');
    folderId = f.id;
    space = f.space;
    spaceId = f.space_id ?? null;
  }
  // Los defaults del workspace solo valen para lo nuevo; sin fila de ajustes, los de siempre.
  const defaults = (await getDb().prepare('SELECT default_privacy, default_allow_download FROM rec_settings WHERE workspace_id = ?').get(a.ws)) as
    | { default_privacy: string; default_allow_download: number }
    | undefined;
  const id = crypto.randomUUID();
  const mode: RecMode = (['screen_camera', 'screen', 'camera'] as const).includes(input.mode) ? input.mode : 'screen_camera';
  await getDb()
    .prepare(
      `INSERT INTO rec_videos (id, workspace_id, created_by, share_id, title, title_source, mode, content_type, folder_id, space, space_id, privacy, allow_download)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      a.ws,
      a.actor,
      newShareId(),
      (input.title.trim() || 'Video').slice(0, 200),
      input.titleSource === 'user' && input.title.trim() ? 'user' : 'auto',
      mode,
      input.contentType.split(';')[0].slice(0, 40) || 'video/webm',
      folderId,
      space,
      spaceId,
      defaults?.default_privacy === 'workspace' ? 'workspace' : 'link',
      defaults ? (defaults.default_allow_download ? 1 : 0) : 1,
    );
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
  commentsRequireAccount?: boolean;
  spaceId?: string | null;
  allowedEmails?: string[];
  requireEmail?: boolean;
  archived?: boolean;
  overlays?: unknown;
}

/** Mínimo de caracteres de una contraseña nueva (las que ya estaban siguen valiendo). */
export const MIN_PASSWORD = 8;

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
  if (patch.summary !== undefined && patch.summary.trim() !== v.summary.trim()) {
    set('summary', patch.summary.trim().slice(0, 5000));
    set('summary_source', 'user');
  }
  if (patch.chaptersText !== undefined) {
    const ch = parseChapters(patch.chaptersText, v.duration_sec > 0 ? v.duration_sec : Infinity);
    set('chapters', JSON.stringify(ch));
    set('chapters_source', 'user');
  }
  let finalSpace: RecSpace = v.space;
  if (patch.folderId !== undefined || patch.space !== undefined || patch.spaceId !== undefined) {
    if (patch.folderId) {
      const f = await getFolder(a, patch.folderId);
      if (!f) throw new RecError('invalid_folder');
      set('folder_id', f.id);
      set('space', f.space);
      set('space_id', f.space_id ?? null);
      finalSpace = f.space;
    } else if (patch.spaceId) {
      set('folder_id', null);
      set('space', 'workspace');
      set('space_id', await usableSpace(a, patch.spaceId));
      finalSpace = 'workspace';
    } else if (patch.space === undefined && patch.spaceId === undefined) {
      // Solo sacar de la carpeta: queda donde estaba (un espacio cerrado sigue cerrado).
      set('folder_id', null);
    } else {
      finalSpace = patch.space === 'workspace' ? 'workspace' : patch.space === 'personal' ? 'personal' : v.space;
      set('folder_id', null);
      set('space', finalSpace);
      set('space_id', null);
    }
  }
  // "Solo estas personas" es de videos personales: en un espacio compartido lo ven sus miembros.
  const finalPeople = patch.privacy !== undefined ? patch.privacy === 'people' : !!v.people_only;
  if (finalPeople && finalSpace !== 'personal') throw new RecError('people_needs_personal');
  if (patch.privacy !== undefined) {
    set('privacy', patch.privacy === 'link' ? 'link' : 'workspace');
    set('people_only', patch.privacy === 'people' ? 1 : 0);
  }
  // Igual que al borrar un espacio: "solo workspace" adentro era solo para sus miembros y en un video personal abriría a todos.
  else if (v.space_id && v.privacy === 'workspace' && !v.people_only && finalSpace === 'personal') {
    set('people_only', 1);
  }
  if (patch.allowedEmails !== undefined) {
    if (cleanEmails(patch.allowedEmails.slice(0, MAX_REC_ALLOWED)).length < new Set(cleanEmails(patch.allowedEmails)).size || patch.allowedEmails.length > MAX_REC_ALLOWED) throw new RecError('allowed_full');
    set('allowed_emails', JSON.stringify(cleanEmails(patch.allowedEmails)));
  }
  if (patch.requireEmail !== undefined) set('require_email', patch.requireEmail ? 1 : 0);
  if (patch.archived !== undefined) set('archived_at', patch.archived ? nowDb() : null);
  if (patch.overlays !== undefined) set('overlays', JSON.stringify(cleanOverlays(patch.overlays, v.duration_sec > 0 ? v.duration_sec : Infinity)));
  if (patch.password !== undefined) {
    if (patch.password === null || patch.password === '') set('password_hash', null);
    else {
      if (patch.password.length < MIN_PASSWORD || patch.password.length > 200) throw new RecError('invalid_password');
      set('password_hash', await hashPassword(patch.password));
      // Con contraseña, la descarga queda apagada salvo que la persona la prenda en el mismo cambio.
      if (!v.password_hash && patch.allowDownload === undefined) set('allow_download', 0);
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
  if (patch.commentsRequireAccount !== undefined) set('comments_require_account', patch.commentsRequireAccount ? 1 : 0);
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
  let dropCut: string | null = null;
  if (patch.trimStart !== undefined || patch.trimEnd !== undefined) {
    const rawStart = patch.trimStart ?? v.trim_start;
    const rawEnd = patch.trimEnd === undefined ? v.trim_end : patch.trimEnd;
    if (rawEnd !== null && rawEnd <= rawStart) throw new RecError('invalid_trim');
    const t = clampTrim(rawStart, rawEnd, v.duration_sec);
    // WebM: lo recortado no se sirve a nadie más; antes de guardar el recorte tiene que estar subida la copia cortada.
    if (isTrimmed(t.start, t.end) && v.content_type.startsWith('video/webm') && v.trimmed_for !== trimKey(t.start, t.end)) {
      throw new RecError('trim_needs_cut', 409);
    }
    if (!isTrimmed(t.start, t.end) && v.trimmed_url) {
      dropCut = v.trimmed_url;
      set('trimmed_url', null);
      set('trimmed_for', null);
    }
    set('trim_start', t.start);
    set('trim_end', t.end);
  }
  if (sets.length) {
    await getDb()
      .prepare(`UPDATE rec_videos SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...args, id);
  }
  if (dropCut) await dropRecFiles([dropCut]).catch(() => undefined);
  return (await rawVideo(id))!;
}

/** Copia recortada (sin recodificar) que ven todos menos quien administra el video. */
export async function setTrimmedFile(id: string, url: string, trimFor: string): Promise<void> {
  const prev = (await getDb().prepare('SELECT trimmed_url FROM rec_videos WHERE id = ?').get(id)) as { trimmed_url: string | null } | undefined;
  await getDb().prepare('UPDATE rec_videos SET trimmed_url = ?, trimmed_for = ? WHERE id = ?').run(url, trimFor, id);
  if (prev?.trimmed_url && prev.trimmed_url !== url) await dropRecFiles([prev.trimmed_url]).catch(() => undefined);
}

/**
 * Qué archivo de video recibe esta persona: quien administra, el original;
 * los demás, con recorte, la copia cortada (WebM) o el original si el tipo
 * no se puede cortar (MP4/MOV: el reproductor respeta el recorte, los bytes no).
 */
export function videoFileFor(v: RecVideoRow, manager: boolean): string | null {
  if (manager || !isTrimmed(v.trim_start, v.trim_end)) return v.url;
  if (v.trimmed_url && v.trimmed_for === trimKey(v.trim_start, v.trim_end)) return v.trimmed_url;
  return v.content_type.startsWith('video/webm') ? null : v.url;
}

export async function deleteVideo(a: RecActor, id: string): Promise<void> {
  const v = await manageable(a, id);
  await getDb().prepare('DELETE FROM rec_videos WHERE id = ?').run(id);
  const { deleteRecParts } = await import('./rec-upload');
  await deleteRecParts(id).catch(() => undefined);
  await dropRecFiles([v.url, v.audio_url, v.thumb_url, v.gif_url, v.trimmed_url].filter((u): u is string => !!u));
}

/**
 * ¿Pasar este video a Docs o Track amplía quién lee la transcripción? Solo no lo
 * hace si ya está en el espacio general del workspace, sin contraseña ni lista.
 */
export function exportWidens(v: Pick<RecVideoRow, 'space' | 'space_id' | 'people_only' | 'password_hash'>): boolean {
  return v.space !== 'workspace' || !!v.space_id || !!v.people_only || !!v.password_hash;
}

/** Link nuevo: el anterior (y las cookies de contraseña y de email atadas a él) deja de andar. */
export async function rotateShareId(a: RecActor, id: string): Promise<RecVideoRow> {
  await manageable(a, id);
  await getDb().prepare("UPDATE rec_videos SET share_id = ?, updated_at = datetime('now') WHERE id = ?").run(newShareId(), id);
  return (await rawVideo(id))!;
}

/** "Ver más tarde" de esta persona, sobre lo que puede ver. */
export async function setWatchLater(a: RecActor, id: string, on: boolean): Promise<void> {
  const v = await getVideoRow(a, id);
  if (!v) throw new RecError('not_found', 404);
  if (on) await getDb().prepare('INSERT OR IGNORE INTO rec_watch_later (user_id, video_id) VALUES (?, ?)').run(a.actor, id);
  else await getDb().prepare('DELETE FROM rec_watch_later WHERE user_id = ? AND video_id = ?').run(a.actor, id);
}

export async function isWatchLater(a: RecActor, id: string): Promise<boolean> {
  return !!(await getDb().prepare('SELECT 1 FROM rec_watch_later WHERE user_id = ? AND video_id = ?').get(a.actor, id));
}

/**
 * Lo más restrictivo de las fuentes de una copia: nadie que no pudiera ver todas
 * las partes gana acceso. La lista de emails es la intersección de las fuentes
 * que limitan. Un "solo workspace" dentro de un espacio queda como personas
 * puntuales: la copia es personal y si no lo verían todos los del workspace. Dos
 * contraseñas distintas no se pueden combinar y se rechaza.
 */
export function strictestAccess(
  sources: Array<Pick<RecVideoRow, 'privacy' | 'people_only' | 'allowed_emails' | 'password_hash' | 'expires_at' | 'allow_download' | 'require_email' | 'comments_require_account' | 'space_id'>>,
): { privacy: 'link' | 'workspace'; people_only: number; allowed_emails: string; password_hash: string | null; expires_at: string | null; allow_download: number; require_email: number; comments_require_account: number } {
  const limiting = sources.filter((s) => s.privacy === 'workspace' || s.people_only);
  const people = sources.some((s) => s.people_only || (s.privacy === 'workspace' && s.space_id));
  let list: string[] | null = null;
  for (const s of limiting) {
    const own = parseJson<string[]>(s.allowed_emails, []);
    list = list === null ? own : list.filter((e) => own.includes(e));
  }
  const passwords = [...new Set(sources.map((s) => s.password_hash).filter((p): p is string => !!p))];
  if (passwords.length > 1) throw new RecError('join_mixed_password');
  const expiries = sources.map((s) => s.expires_at).filter((e): e is string => !!e).sort();
  return {
    privacy: limiting.length ? 'workspace' : 'link',
    people_only: people ? 1 : 0,
    allowed_emails: JSON.stringify(list ?? []),
    password_hash: passwords[0] ?? null,
    expires_at: expiries[0] ?? null,
    allow_download: sources.every((s) => s.allow_download) ? 1 : 0,
    require_email: sources.some((s) => s.require_email) ? 1 : 0,
    comments_require_account: sources.some((s) => s.comments_require_account) ? 1 : 0,
  };
}

/**
 * Cierra una copia armada en el navegador (uniendo o sacando partes). No pasa
 * por la cola de transcripción: la transcripción y los capítulos salen de las
 * fuentes, sin gastar IA. El resumen no se copia (puede hablar de lo que se
 * sacó). Toma lo más restrictivo de todas las fuentes (strictestAccess): una copia
 * de algo protegido nunca queda más abierta.
 */
export async function finalizeDerived(
  a: RecActor,
  id: string,
  input: { durationSec: number; width?: number; height?: number; sources: string[]; pieces: RecEditPiece[] },
): Promise<RecVideoRow> {
  const v = await manageable(a, id);
  if (!v.url) throw new RecError('upload_incomplete', 409);
  if (!input.sources.length || input.sources.length > 10) throw new RecError('invalid_input');
  const sources: RecVideoRow[] = [];
  for (const sid of input.sources) {
    const s = await manageable(a, sid);
    if (s.status !== 'ready') throw new RecError('not_ready', 409);
    sources.push(s);
  }
  const pieces = input.pieces.filter((p) => Number.isInteger(p.src) && p.src >= 0 && p.src < sources.length && p.to > p.from);
  const segs = remapSegments(sources.map((s) => parseJson<RecSegment[]>(s.transcript, [])), pieces);
  const chapters = remapChapters(sources.map((s) => parseJson<RecChapter[]>(s.chapters, [])), pieces);
  const first = sources[0];
  const access = strictestAccess(sources);
  const duration = Math.max(0, Math.min(Number(input.durationSec) || 0, 12 * 3600));
  await getDb()
    .prepare(
      `UPDATE rec_videos SET status = 'ready', duration_sec = ?, width = ?, height = ?, transcript = ?, transcript_status = ?, transcript_lang = ?,
         chapters = ?, summary = '', privacy = ?, people_only = ?, allowed_emails = ?, require_email = ?, password_hash = ?, expires_at = ?, allow_download = ?,
         comments_require_account = ?, updated_at = datetime('now')
       WHERE id = ? AND status = 'recording'`,
    )
    .run(
      duration,
      Math.max(0, Math.round(Number(input.width) || 0)),
      Math.max(0, Math.round(Number(input.height) || 0)),
      JSON.stringify(segs),
      segs.length ? 'done' : 'none',
      first.transcript_lang,
      JSON.stringify(chapters),
      access.privacy,
      access.people_only,
      access.allowed_emails,
      access.require_email,
      access.password_hash,
      access.expires_at,
      access.allow_download,
      access.comments_require_account,
      id,
    );
  return (await rawVideo(id))!;
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
  if (prev?.u && prev.u !== url) await dropRecFiles([prev.u]).catch(() => undefined);
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

export type PublicAccess = 'ok' | 'expired' | 'password' | 'email' | 'signin' | 'forbidden';

export interface PublicViewer {
  /** Workspace de la sesión (null sin login). */
  ws: string | null;
  /** Persona real logueada (null sin login). */
  userId: string | null;
  /** Email de la sesión (para "personas puntuales"). */
  email?: string | null;
  /** Video en un espacio: esta persona entra a ese espacio (sin dato, no). */
  spaceMember?: boolean;
  /** Ya dejó su email para este video (sin login). */
  emailPassed?: boolean;
}

/** Valor de la cookie del pedido de email: cambia si se rota el link. */
export function emailGateToken(v: Pick<RecVideoRow, 'share_id'>): string {
  return createHmac('sha256', process.env.NEXTAUTH_SECRET ?? 'rec').update(`email:${v.share_id}`).digest('base64url');
}

export function emailGateCookie(shareId: string): string {
  return `rec_em_${shareId}`;
}

/**
 * ¿Puede ver este video quien abrió el link? Solo el autor saltea las
 * reglas (para revisarlo aun vencido o con contraseña). Un miembro del
 * workspace pasa "solo workspace" pero respeta contraseña y vencimiento
 * como cualquiera. `unlock` es el valor de la cookie de la contraseña.
 */
export function publicAccess(
  v: Pick<RecVideoRow, 'workspace_id' | 'created_by' | 'share_id' | 'password_hash' | 'expires_at' | 'privacy'> & Partial<Pick<RecVideoRow, 'people_only' | 'allowed_emails' | 'require_email' | 'space_id'>>,
  viewer: PublicViewer,
  unlock: string | null,
  now = Date.now(),
): PublicAccess {
  if (viewer.userId && viewer.userId === v.created_by && viewer.ws === v.workspace_id) return 'ok';
  if (v.expires_at && dbTime(v.expires_at) <= now) return 'expired';
  const listed = !!viewer.email && parseJson<string[]>(v.allowed_emails, []).includes(viewer.email.trim().toLowerCase());
  const member = viewer.ws === v.workspace_id && (!v.space_id || viewer.spaceMember === true);
  if (v.people_only ? !listed : v.privacy === 'workspace' && !member && !listed) return viewer.userId || viewer.ws ? 'forbidden' : 'signin';
  if (v.password_hash) {
    const want = unlockToken(v);
    if (!unlock || unlock.length !== want.length || !timingSafeEqual(Buffer.from(unlock), Buffer.from(want))) return 'password';
  }
  if (v.require_email && !viewer.userId && !viewer.emailPassed) return 'email';
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
  commentsRequireAccount: boolean;
  ctaLabel: string;
  ctaUrl: string;
  ctaMode: RecCtaMode;
  hasThumb: boolean;
  overlays: RecOverlay[];
}

/** Lo que ve quien abre el link. Si no es el autor, solo lo que queda dentro del recorte. */
export function toPublicDto(v: RecVideoRow & { author_name: string | null }, isAuthor = false): PublicVideoDto {
  const chapters = normalizeChapters(parseJson<RecChapter[]>(v.chapters, []));
  const segments = parseJson<RecSegment[]>(v.transcript, []);
  return {
    shareId: v.share_id,
    title: v.title,
    description: v.description,
    chapters: isAuthor ? chapters : chaptersInTrim(chapters, v.trim_start, v.trim_end),
    authorName: v.author_name ?? '',
    createdAt: v.created_at,
    durationSec: v.duration_sec,
    trimStart: v.trim_start,
    trimEnd: v.trim_end,
    contentType: v.content_type,
    transcript: isAuthor ? segments : segmentsInTrim(segments, v.trim_start, v.trim_end),
    summary: isAuthor || summaryFitsTrim(v) ? v.summary : '',
    allowDownload: !!v.allow_download,
    allowComments: !!v.allow_comments,
    commentsRequireAccount: !!v.comments_require_account,
    ctaLabel: v.cta_label ?? '',
    ctaUrl: v.cta_url ?? '',
    ctaMode: v.cta_mode,
    hasThumb: !!v.thumb_url && (isAuthor || assetVisible(v, 'thumb')),
    overlays: isAuthor ? parseJson<RecOverlay[]>(v.overlays, []) : overlaysInTrim(parseJson<RecOverlay[]>(v.overlays, []), v.trim_start, v.trim_end),
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

/**
 * Comentarios y reacciones avisan agrupados: si el autor tiene un aviso sin
 * leer de este video, se suma ahí ("N comentarios nuevos") en vez de mandar
 * uno por comentario.
 */
async function notifyCommentGrouped(v: RecVideoRow, name: string, kind: 'comment' | 'reaction', text: string, emoji: string | null): Promise<void> {
  if (!v.notify) return;
  try {
    const db = getDb();
    const open = (await db
      .prepare("SELECT id, meta FROM notifications WHERE user_id = ? AND type = 'rec_comment' AND source_id = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT 1")
      .get(v.created_by, v.id)) as { id: string; meta: string } | undefined;
    if (open) {
      const meta = parseJson<Record<string, unknown>>(open.meta, {});
      const count = (Number(meta.count) || 1) + 1;
      await db
        .prepare("UPDATE notifications SET title = ?, meta = ?, created_at = datetime('now') WHERE id = ?")
        .run(`${count} new comments on "${v.title}"`, JSON.stringify({ ...meta, count, actorName: name, title: v.title }), open.id);
      return;
    }
    await notifyAuthor(
      v,
      'rec_comment',
      kind === 'comment' ? `${name} commented on "${v.title}": ${text.slice(0, 80)}` : `${name} reacted ${emoji} to "${v.title}"`,
      kind === 'comment' ? { actorName: name, count: '1' } : { actorName: name, emoji: emoji ?? '', count: '1' },
    );
  } catch {
    /* idem */
  }
}

export async function trackRecView(
  v: RecVideoRow,
  viewer: RecViewer,
  input: { viewId?: string; watched?: number; position?: number; duration?: number; cta?: boolean; ranges?: Range[]; ip?: string; userAgent?: string },
): Promise<{ viewId: string | null }> {
  if (viewer.isAuthor) return { viewId: null };
  const db = getDb();
  const visible = trimmedDuration(v.duration_sec, v.trim_start, v.trim_end);
  const duration = Math.max(0, Math.min(Number(input.duration) || visible, 12 * 3600));
  if (input.viewId) {
    const view = (await db.prepare('SELECT * FROM rec_views WHERE id = ? AND video_id = ? AND viewer_key = ?').get(input.viewId, v.id, viewer.key)) as
      | { id: string; watched_sec: number; max_position: number; last_ping_at: string; cta_clicks: number; ranges: string }
      | undefined;
    if (!view) return { viewId: null };
    const elapsed = (Date.now() - dbTime(view.last_ping_at)) / 1000;
    const target = Math.max(view.watched_sec, Number(input.watched) || 0);
    const watched = Math.min(target, view.watched_sec + Math.max(60, Math.ceil(elapsed) + 5));
    const maxPos = Math.max(view.max_position, Math.min(Number(input.position) || 0, duration || Number.MAX_SAFE_INTEGER));
    // Intervalos realmente reproducidos: se unen con lo que ya había (los pings mandan todo lo visto).
    const ranges = mergeRanges([...parseJson<Range[]>(view.ranges, []), ...(input.ranges ?? [])], duration || Infinity);
    await db
      .prepare('UPDATE rec_views SET watched_sec = ?, max_position = ?, duration_sec = ?, cta_clicks = cta_clicks + ?, ranges = ?, last_ping_at = ? WHERE id = ?')
      .run(watched, maxPos, duration, input.cta ? 1 : 0, JSON.stringify(ranges), nowDb(), view.id);
    return { viewId: view.id };
  }
  const first = !(await db.prepare('SELECT 1 FROM rec_views WHERE video_id = ? AND viewer_key = ? LIMIT 1').get(v.id, viewer.key));
  const id = crypto.randomUUID();
  const ts = nowDb();
  await db
    .prepare(
      `INSERT INTO rec_views (id, video_id, workspace_id, viewer_key, user_id, viewer_name, duration_sec, cta_clicks, ranges, ip_hash, user_agent, started_at, last_ping_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      v.id,
      v.workspace_id,
      viewer.key,
      viewer.userId,
      viewer.name.slice(0, 120),
      duration,
      input.cta ? 1 : 0,
      JSON.stringify(mergeRanges(input.ranges ?? [], duration || Infinity)),
      hashIp(input.ip ?? ''),
      (input.userAgent ?? '').slice(0, 300),
      ts,
      ts,
    );
  await db.prepare('UPDATE rec_videos SET views = views + 1, last_viewed_at = ? WHERE id = ?').run(ts, v.id);
  if (first) await notifyAuthor(v, 'rec_view', `${viewer.name || 'Someone'} watched "${v.title}"`, viewer.name ? { actorName: viewer.name } : {});
  return { viewId: id };
}

export interface RecViewerRow {
  viewerKey: string;
  name: string;
  /** El que dejó en el pedido de email (sin verificar). */
  email: string;
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
  /** Qué parte de los espectadores vio cada 5 % del video. */
  retention: number[];
  viewers: RecViewerRow[];
}

/**
 * Analítica (solo para quien administra el video). El % visto es tiempo
 * distinto realmente reproducido (unión de intervalos, adelantar no cuenta);
 * para vistas viejas sin intervalos, la posición máxima.
 */
export async function getAnalytics(a: RecActor, id: string): Promise<RecAnalytics> {
  const v = await getVideoRow(a, id);
  if (!v) throw new RecError('not_found', 404);
  if (!canManage(a, v)) throw new RecError('forbidden', 403);
  const rows = (await getDb()
    .prepare(
      `SELECT w.viewer_key, w.user_id, w.viewer_name, w.watched_sec, w.max_position, w.duration_sec, w.cta_clicks, w.ranges, w.started_at, e.email AS gate_email
       FROM rec_views w LEFT JOIN rec_viewer_emails e ON e.video_id = w.video_id AND e.viewer_key = w.viewer_key
       WHERE w.video_id = ? ORDER BY w.started_at DESC LIMIT 5000`,
    )
    .all(id)) as Array<{
    gate_email: string | null;
    viewer_key: string;
    user_id: string | null;
    viewer_name: string;
    watched_sec: number;
    max_position: number;
    duration_sec: number;
    cta_clicks: number;
    ranges: string;
    started_at: string;
  }>;
  const visible = trimmedDuration(v.duration_sec, v.trim_start, v.trim_end);
  const by = new Map<string, RecViewerRow & { ranges: Range[] }>();
  let ctaClicks = 0;
  for (const r of rows) {
    const d = r.duration_sec > 0 ? r.duration_sec : visible;
    const own = parseJson<Range[]>(r.ranges, []);
    const ranges = own.length ? own : r.max_position > 0 ? ([[0, Math.min(r.max_position, r.watched_sec || r.max_position)]] as Range[]) : [];
    ctaClicks += r.cta_clicks;
    const cur = by.get(r.viewer_key);
    if (!cur) {
      by.set(r.viewer_key, {
        viewerKey: r.viewer_key,
        name: r.viewer_name,
        email: r.gate_email ?? '',
        signedIn: !!r.user_id,
        views: 1,
        watchedSec: r.watched_sec,
        pct: 0,
        ctaClicks: r.cta_clicks,
        lastAt: r.started_at,
        ranges: mergeRanges(ranges, d),
      });
    } else {
      cur.views++;
      cur.watchedSec += r.watched_sec;
      cur.ctaClicks += r.cta_clicks;
      cur.ranges = mergeRanges([...cur.ranges, ...ranges], d);
      if (!cur.name && r.viewer_name) cur.name = r.viewer_name;
    }
  }
  const viewers = [...by.values()].map((x) => ({ ...x, pct: coveredPct(x.ranges, visible) }));
  const pcts = viewers.map((x) => x.pct);
  return {
    views: rows.length,
    unique: viewers.length,
    avgPct: pcts.length ? Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length) : 0,
    completed: pcts.filter((p) => p >= 95).length,
    ctaClicks,
    retention: retentionCurve(
      viewers.map((x) => x.ranges),
      visible,
    ),
    viewers: viewers.map(({ ranges: _r, ...rest }) => rest),
  };
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
  /** Sin cuenta: se muestra como invitado. */
  guest: boolean;
  /** Lo escribió quien grabó el video. */
  byAuthor: boolean;
  mine: boolean;
  createdAt: string;
}

export interface RecCommentPage {
  comments: RecCommentDto[];
  /** Reacciones por emoji (todas). */
  reactions: Record<string, number>;
  /** Las últimas 50 reacciones con su segundo (para la línea de tiempo). */
  reactionMarks: RecCommentDto[];
  /** Cursor para la página siguiente (comentarios más viejos), o null. */
  nextBefore: string | null;
  total: number;
}

type CommentRow = {
  id: string;
  parent_id: string | null;
  kind: 'comment' | 'reaction';
  body: string;
  emoji: string | null;
  at_sec: number | null;
  user_id: string | null;
  author_name: string;
  viewer_key: string;
  created_at: string;
};

function commentDto(r: CommentRow, viewerKey: string | null, authorId: string): RecCommentDto {
  return {
    id: r.id,
    parentId: r.parent_id,
    kind: r.kind,
    body: r.body,
    emoji: r.emoji,
    atSec: r.at_sec,
    authorName: r.author_name,
    guest: !r.user_id,
    byAuthor: !!r.user_id && r.user_id === authorId,
    mine: !!viewerKey && r.viewer_key === viewerKey,
    createdAt: r.created_at,
  };
}

export const COMMENTS_PAGE = 50;

/** Comentarios de a 50 (los más nuevos primero, con sus respuestas) y el resumen de reacciones. */
export async function listComments(
  v: Pick<RecVideoRow, 'id' | 'created_by'>,
  viewerKey: string | null,
  opts: { before?: string | null; limit?: number } = {},
): Promise<RecCommentPage> {
  const db = getDb();
  const limit = Math.max(1, Math.min(opts.limit ?? COMMENTS_PAGE, 200));
  // Orden estable por rowid (orden de llegada): varios comentarios pueden caer en el mismo segundo.
  const before = opts.before && /^\d{1,15}$/.test(opts.before) ? Number(opts.before) : null;
  const top = (await db
    .prepare(
      `SELECT rowid AS rid, * FROM rec_comments WHERE video_id = ? AND kind = 'comment' AND parent_id IS NULL ${before !== null ? 'AND rowid < ?' : ''}
       ORDER BY rowid DESC LIMIT ?`,
    )
    .all(...(before !== null ? [v.id, before, limit + 1] : [v.id, limit + 1]))) as Array<CommentRow & { rid: number }>;
  const page = top.slice(0, limit);
  const ids = page.map((c) => c.id);
  const replies = ids.length
    ? ((await db
        .prepare(`SELECT * FROM rec_comments WHERE video_id = ? AND parent_id IN (${ids.map(() => '?').join(',')}) ORDER BY rowid ASC`)
        .all(v.id, ...ids)) as CommentRow[])
    : [];
  const counts = (await db
    .prepare("SELECT emoji, COUNT(*) AS n FROM rec_comments WHERE video_id = ? AND kind = 'reaction' GROUP BY emoji")
    .all(v.id)) as Array<{ emoji: string; n: number }>;
  const marks = (await db
    .prepare("SELECT * FROM rec_comments WHERE video_id = ? AND kind = 'reaction' AND at_sec IS NOT NULL ORDER BY rowid DESC LIMIT 50")
    .all(v.id)) as CommentRow[];
  const total = Number(
    ((await db.prepare("SELECT COUNT(*) AS n FROM rec_comments WHERE video_id = ? AND kind = 'comment' AND parent_id IS NULL").get(v.id)) as { n: number }).n,
  );
  return {
    comments: [...page.map(({ rid: _rid, ...r }) => r), ...replies].map((r) => commentDto(r, viewerKey, v.created_by)),
    reactions: Object.fromEntries(counts.map((c) => [c.emoji, Number(c.n)])),
    reactionMarks: marks.map((r) => commentDto(r, viewerKey, v.created_by)),
    nextBefore: top.length > limit ? String(page[page.length - 1].rid) : null,
    total,
  };
}

export async function addComment(
  v: RecVideoRow,
  viewer: RecViewer,
  input: { kind: 'comment' | 'reaction'; body?: string; emoji?: string; atSec?: number | null; parentId?: string | null },
): Promise<RecCommentDto> {
  if (!v.allow_comments) throw new RecError('comments_off', 403);
  if (v.comments_require_account && !viewer.userId) throw new RecError('signin_required', 403);
  const { REC_REACTIONS } = await import('./rec-schema');
  const kind = input.kind === 'reaction' ? 'reaction' : 'comment';
  const body = kind === 'comment' ? String(input.body ?? '').trim().slice(0, 4000) : '';
  const emoji = kind === 'reaction' ? String(input.emoji ?? '') : null;
  if (kind === 'comment' && !body) throw new RecError('empty_comment');
  if (kind === 'reaction' && !(REC_REACTIONS as readonly string[]).includes(emoji ?? '')) throw new RecError('invalid_reaction');
  // Todos los invitados se publican igual: el nombre que escribieron, marcado
  // como invitado (badge "Invitado" en la UI). No se compara con los miembros:
  // la respuesta no puede decir si un nombre es de alguien del workspace.
  const name = viewer.name.trim().slice(0, 80);
  if (!name) throw new RecError('name_required');
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const { rateLimit } = await import('./rate-limit');
    const r = await rateLimit(`rec:comment:video:${v.id}`, 120, 600);
    if (!r.ok) throw new RecError('rate_limited', 429);
  }
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
  if (!viewer.isAuthor) await notifyCommentGrouped(v, viewer.userId ? name : `${name} (guest)`, kind, body, emoji);
  const row = (await getDb().prepare('SELECT * FROM rec_comments WHERE id = ?').get(id)) as CommentRow;
  return commentDto(row, viewer.key, v.created_by);
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
 * a los 7 días se borran con sus partes (hasta entonces se pueden reanudar
 * desde el navegador que las grabó). Lo corre el cron de cada minuto.
 */
export const STALE_RECORDING_DAYS = 7;

export async function cleanupStaleRecordings(limit = 20): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RECORDING_DAYS * 24 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  const rows = (await getDb()
    .prepare("SELECT id, url, audio_url, thumb_url, gif_url FROM rec_videos WHERE status = 'recording' AND created_at < ? LIMIT ?")
    .all(cutoff, limit)) as Array<Pick<RecVideoRow, 'id' | 'url' | 'audio_url' | 'thumb_url' | 'gif_url'>>;
  const { deleteRecParts } = await import('./rec-upload');
  for (const r of rows) {
    const res = await getDb().prepare("DELETE FROM rec_videos WHERE id = ? AND status = 'recording'").run(r.id);
    if (!res.changes) continue;
    await deleteRecParts(r.id).catch(() => undefined);
    await dropRecFiles([r.url, r.audio_url, r.thumb_url, r.gif_url].filter((u): u is string => !!u));
  }
  const { cleanEmptyPartDirs } = await import('./rec-upload');
  await cleanEmptyPartDirs().catch(() => undefined);
  return rows.length;
}
