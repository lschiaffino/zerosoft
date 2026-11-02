/**
 * Send: documentos, versiones, subida por partes, render y links. Server-only.
 *
 * Permisos (docs/permissions.md): un member ve lo suyo y lo compartido con el
 * workspace; edita y borra lo suyo. Un admin ve y edita todo. En un documento
 * compartido, un member puede armar sus propios links.
 */
import { getDb } from '../db';
import { hashPassword } from '../links';
import { guardPdf } from '../sign/pdf';
import { blocksToPdf, needsUnicodeFont } from '../docs-pdf';
import { docxToBlocks } from '../docs-docx';
import { USAGE_RATES } from '../pricing';
import { deleteSendFiles, openSendValue, readSendFile, sealSendValue, sendStorageConfigured, storeSendFile } from './files';
import { loadRenderEngine, openPdf } from './render';
import { assertOfficeSize, pptxToImages } from './office';
import {
  cleanAccessList,
  hashToken,
  LIVE_WINDOW_MS,
  linkState,
  MAX_DOCUMENT_BYTES,
  MAX_PAGES,
  MAX_VIDEO_BYTES,
  newId,
  newToken,
  normalizeEmail,
  nowIso,
  parseAccessList,
  PART_BYTES,
  SendError,
  sniffKind,
  videoBuckets,
  type AccessMode,
  type SendActor,
  type VersionKind,
  type VersionStatus,
} from './types';

export interface DocumentRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  title: string;
  sharing: string;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface VersionRow {
  id: string;
  document_id: string;
  workspace_id: string;
  n: number;
  kind: VersionKind;
  name: string;
  mime: string;
  size: number;
  part_count: number;
  status: VersionStatus;
  error: string | null;
  page_count: number;
  rendered_count: number;
  render_claimed_at: number | null;
  render_stalls: number;
  duration_sec: number | null;
  bucket_sec: number | null;
  note: string | null;
  source_ref: string | null;
  derived_ref: string | null;
  created_by: string;
  created_at: string;
  ready_at: string | null;
}

export interface LinkRow {
  id: string;
  workspace_id: string;
  document_id: string | null;
  space_id: string | null;
  created_by: string;
  name: string;
  recipient_email: string | null;
  token_hash: string;
  token_sealed: string;
  require_email: number;
  verify_email: number;
  passcode_hash: string | null;
  expires_at: string | null;
  allow_download: number;
  access_mode: AccessMode;
  access_list: string;
  watermark: number;
  nda_template_id: string | null;
  message: string;
  notify: number;
  use_branding: number;
  access_epoch: number;
  disabled_at: string | null;
  last_visit_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  alert_window_at: number | null;
  alert_count: number;
  alert_digest: number;
  /** Lo arma resolveLink: emails del acceso por persona del espacio, si hay lista. */
  space_emails?: readonly string[];
}

// ---------- Permisos ----------

export function canEditDocument(actor: SendActor, d: Pick<DocumentRow, 'owner_id'>): boolean {
  return actor.admin || d.owner_id === actor.person;
}

const visibleSql = `(? = 1 OR d.owner_id = ? OR d.sharing = 'workspace')`;

export async function getDocument(actor: SendActor, id: string): Promise<DocumentRow> {
  const row = (await getDb()
    .prepare(`SELECT d.* FROM send_documents d WHERE d.id = ? AND d.workspace_id = ? AND d.deleted_at IS NULL AND ${visibleSql}`)
    .get(id, actor.ws, actor.admin ? 1 : 0, actor.person)) as DocumentRow | undefined;
  if (!row) throw new SendError('not_found', 404);
  return row;
}

export async function requireEditDocument(actor: SendActor, id: string): Promise<DocumentRow> {
  const row = await getDocument(actor, id);
  if (!canEditDocument(actor, row)) throw new SendError('forbidden', 403);
  return row;
}

// ---------- Lista ----------

export interface DocumentListItem {
  id: string;
  title: string;
  sharing: string;
  mine: boolean;
  kind: VersionKind | null;
  status: VersionStatus | null;
  pageCount: number;
  links: number;
  visits: number;
  live: number;
  lastVisitAt: string | null;
  updatedAt: string;
}

export async function listDocuments(actor: SendActor, opts: { q?: string; limit?: number } = {}): Promise<DocumentListItem[]> {
  const liveSince = new Date(Date.now() - LIVE_WINDOW_MS).toISOString();
  const q = (opts.q ?? '').trim().slice(0, 100);
  const rows = (await getDb()
    .prepare(
      `SELECT d.id, d.title, d.sharing, d.owner_id, d.updated_at,
         COALESCE(v.kind, lv.kind) AS kind, COALESCE(v.status, lv.status) AS status, COALESCE(v.page_count, lv.page_count, 0) AS page_count,
         (SELECT COUNT(*) FROM send_links l WHERE l.document_id = d.id AND l.deleted_at IS NULL) AS links,
         (SELECT COUNT(*) FROM send_visits s WHERE s.document_id = d.id) AS visits,
         (SELECT COUNT(DISTINCT s.session_id) FROM send_visits s WHERE s.document_id = d.id AND s.last_ping_at >= ?) AS live,
         (SELECT MAX(s.last_ping_at) FROM send_visits s WHERE s.document_id = d.id) AS last_visit_at
       FROM send_documents d
       LEFT JOIN send_versions v ON v.id = d.current_version_id
       LEFT JOIN send_versions lv ON lv.document_id = d.id AND lv.n = (SELECT MAX(x.n) FROM send_versions x WHERE x.document_id = d.id)
       WHERE d.workspace_id = ? AND d.deleted_at IS NULL AND ${visibleSql}
         AND (? = '' OR d.title LIKE ? ESCAPE '\\')
       ORDER BY d.updated_at DESC LIMIT ?`,
    )
    .all(liveSince, actor.ws, actor.admin ? 1 : 0, actor.person, q, `%${q.replace(/[\\%_]/g, '\\$&')}%`, opts.limit ?? 200)) as Array<{
    id: string;
    title: string;
    sharing: string;
    owner_id: string;
    updated_at: string;
    kind: VersionKind | null;
    status: VersionStatus | null;
    page_count: number;
    links: number;
    visits: number;
    live: number;
    last_visit_at: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    sharing: r.sharing,
    mine: r.owner_id === actor.person,
    kind: r.kind,
    status: r.status,
    pageCount: Number(r.page_count),
    links: Number(r.links),
    visits: Number(r.visits),
    live: Number(r.live),
    lastVisitAt: r.last_visit_at,
    updatedAt: r.updated_at,
  }));
}

// ---------- Documentos ----------

export async function createDocument(actor: SendActor, title: string): Promise<DocumentRow> {
  const id = newId('sd');
  const ts = nowIso();
  await getDb()
    .prepare('INSERT INTO send_documents (id, workspace_id, owner_id, title, sharing, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.ws, actor.person, title.trim().slice(0, 200) || 'Untitled', 'private', ts, ts);
  return (await getDb().prepare('SELECT * FROM send_documents WHERE id = ?').get(id)) as DocumentRow;
}

export async function updateDocument(actor: SendActor, id: string, patch: { title?: string; sharing?: 'private' | 'workspace' }): Promise<DocumentRow> {
  const row = await requireEditDocument(actor, id);
  const title = patch.title !== undefined ? patch.title.trim().slice(0, 200) || row.title : row.title;
  const sharing = patch.sharing ?? row.sharing;
  await getDb().prepare('UPDATE send_documents SET title = ?, sharing = ?, updated_at = ? WHERE id = ?').run(title, sharing, nowIso(), id);
  return { ...row, title, sharing };
}

/** Borra el documento, sus archivos y sus números: el link deja de abrir en el pedido siguiente. */
export async function deleteDocument(actor: SendActor, id: string): Promise<void> {
  await requireEditDocument(actor, id);
  const db = getDb();
  // Primero se corta el acceso: si falla lo de abajo, el documento ya no se ve.
  await db.prepare('UPDATE send_documents SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(nowIso(), id);
  await db.prepare('UPDATE send_links SET deleted_at = ?, disabled_at = COALESCE(disabled_at, ?) WHERE document_id = ?').run(nowIso(), nowIso(), id);
  const versions = (await db.prepare('SELECT id, derived_ref FROM send_versions WHERE document_id = ?').all(id)) as Array<{ id: string; derived_ref: string | null }>;
  for (const v of versions) {
    await purgeVersionFiles(v.id, v.derived_ref);
    await db.prepare('DELETE FROM send_page_views WHERE version_id = ?').run(v.id);
  }
  await db.prepare('DELETE FROM send_space_items WHERE document_id = ?').run(id);
  await db.prepare('DELETE FROM send_page_stats WHERE visit_id IN (SELECT id FROM send_visits WHERE document_id = ?)').run(id);
  await db.prepare('DELETE FROM send_visits WHERE document_id = ?').run(id);
  await db.prepare('DELETE FROM send_events WHERE document_id = ?').run(id);
  await db.prepare('DELETE FROM send_sessions WHERE link_id IN (SELECT id FROM send_links WHERE document_id = ?)').run(id);
  await db.prepare('DELETE FROM send_links WHERE document_id = ?').run(id);
  await db.prepare('DELETE FROM send_versions WHERE document_id = ?').run(id);
  await db.prepare('DELETE FROM send_documents WHERE id = ?').run(id);
  // Un visitante sin otras visitas se va con el documento: su email no queda guardado.
  await db.prepare('DELETE FROM send_visitors WHERE workspace_id = ? AND id NOT IN (SELECT visitor_id FROM send_visits WHERE workspace_id = ? AND visitor_id IS NOT NULL) AND id NOT IN (SELECT visitor_id FROM send_sessions WHERE workspace_id = ? AND visitor_id IS NOT NULL)').run(actor.ws, actor.ws, actor.ws);
}

/** Referencias guardadas como JSON (copias de una descarga con watermark). */
export function storeRefsOf(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

async function purgeVersionFiles(versionId: string, derivedRef: string | null): Promise<void> {
  const db = getDb();
  const parts = (await db.prepare('SELECT ref FROM send_version_parts WHERE version_id = ?').all(versionId)) as Array<{ ref: string }>;
  const pages = (await db.prepare('SELECT ref FROM send_pages WHERE version_id = ?').all(versionId)) as Array<{ ref: string }>;
  const stamped = (await db.prepare('SELECT refs FROM send_download_cache WHERE version_id = ?').all(versionId)) as Array<{ refs: string }>;
  await deleteSendFiles([...parts.map((p) => p.ref), ...pages.map((p) => p.ref), ...stamped.flatMap((c) => storeRefsOf(c.refs)), derivedRef]).catch(() => undefined);
  await db.prepare('DELETE FROM send_download_cache WHERE version_id = ?').run(versionId);
  await db.prepare('DELETE FROM send_version_parts WHERE version_id = ?').run(versionId);
  await db.prepare('DELETE FROM send_pages WHERE version_id = ?').run(versionId);
}

// ---------- Versiones y subida ----------

export interface VersionDto {
  id: string;
  n: number;
  kind: VersionKind;
  name: string;
  size: number;
  status: VersionStatus;
  error: string | null;
  pageCount: number;
  renderedCount: number;
  durationSec: number | null;
  bucketSec: number | null;
  note: string | null;
  createdAt: string;
  current: boolean;
}

export function versionDto(v: VersionRow, currentId: string | null): VersionDto {
  return {
    id: v.id,
    n: v.n,
    kind: v.kind,
    name: v.name,
    size: Number(v.size),
    status: v.status,
    error: v.error,
    pageCount: Number(v.page_count),
    renderedCount: Number(v.rendered_count),
    durationSec: v.duration_sec === null ? null : Number(v.duration_sec),
    bucketSec: v.bucket_sec === null ? null : Number(v.bucket_sec),
    note: v.note,
    createdAt: v.created_at,
    current: v.id === currentId,
  };
}

export async function listVersions(documentId: string): Promise<VersionRow[]> {
  return (await getDb().prepare('SELECT * FROM send_versions WHERE document_id = ? ORDER BY n DESC').all(documentId)) as VersionRow[];
}

export async function getVersion(documentId: string, versionId: string): Promise<VersionRow> {
  const v = (await getDb().prepare('SELECT * FROM send_versions WHERE id = ? AND document_id = ?').get(versionId, documentId)) as VersionRow | undefined;
  if (!v) throw new SendError('not_found', 404);
  return v;
}

/** Versión que se puede ver desde el panel, por id. */
export async function versionForActor(actor: SendActor, versionId: string): Promise<{ version: VersionRow; document: DocumentRow }> {
  const v = (await getDb().prepare('SELECT * FROM send_versions WHERE id = ? AND workspace_id = ?').get(versionId, actor.ws)) as VersionRow | undefined;
  if (!v) throw new SendError('not_found', 404);
  return { version: v, document: await getDocument(actor, v.document_id) };
}

async function nextVersionNumber(documentId: string): Promise<number> {
  const r = (await getDb().prepare('SELECT COALESCE(MAX(n), 0) AS n FROM send_versions WHERE document_id = ?').get(documentId)) as { n: number };
  return Number(r.n) + 1;
}

export interface UploadInput {
  name: string;
  mime: string;
  size: number;
}

function kindFromName(name: string, mime: string): VersionKind | null {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (n.endsWith('.docx')) return 'word';
  if (n.endsWith('.pptx')) return 'slides';
  if (/\.(mp4|webm|mov|m4v)$/.test(n) || /^video\/(mp4|webm|quicktime)$/.test(mime)) return 'video';
  return null;
}

/**
 * Cuota de almacenamiento del workspace, por sus archivos y páginas. En zerosoft Cloud
 * es lo incluido en el plan (lib/pricing.ts); SEND_STORAGE_LIMIT_GB la cambia, y en
 * self-host no hay tope salvo que se defina.
 */
export function sendStorageLimit(): number | null {
  const raw = process.env.SEND_STORAGE_LIMIT_GB?.trim();
  if (raw) {
    const gb = Number(raw);
    return Number.isFinite(gb) && gb > 0 ? gb * 1024 ** 3 : null;
  }
  if (!process.env.VERCEL) return null;
  return (USAGE_RATES.find((r) => r.key === 'storage')?.free ?? 0.5) * 1024 ** 3;
}

export async function sendStorageUsed(workspaceId: string): Promise<number> {
  const db = getDb();
  const files = (await db.prepare(`SELECT COALESCE(SUM(size), 0) AS n FROM send_versions WHERE workspace_id = ? AND status <> 'failed'`).get(workspaceId)) as { n: number };
  const pages = (await db.prepare('SELECT COALESCE(SUM(p.bytes), 0) AS n FROM send_pages p JOIN send_versions v ON v.id = p.version_id WHERE v.workspace_id = ?').get(workspaceId)) as { n: number };
  return Number(files.n) + Number(pages.n);
}

/** Antes de guardar nada: sin dónde guardar, o sin lugar, no queda una fila a medias. */
export async function assertCanStore(workspaceId: string, bytes: number): Promise<void> {
  if (!sendStorageConfigured()) throw new SendError('storage_unavailable', 503);
  const limit = sendStorageLimit();
  if (limit !== null && (await sendStorageUsed(workspaceId)) + bytes > limit) throw new SendError('storage_quota', 413);
}

export async function startUpload(actor: SendActor, documentId: string, input: UploadInput): Promise<VersionRow> {
  const name = input.name.slice(0, 200) || 'document';
  const kind = kindFromName(name, input.mime);
  if (!kind) throw new SendError('unsupported_type', 415);
  const max = kind === 'video' ? MAX_VIDEO_BYTES : MAX_DOCUMENT_BYTES;
  if (!Number.isInteger(input.size) || input.size <= 0) throw new SendError('invalid_input', 400);
  if (input.size > max) throw new SendError('file_too_large', 413);
  await assertCanStore(actor.ws, input.size);
  const id = newId('sv');
  const n = await nextVersionNumber(documentId);
  await getDb()
    .prepare(
      `INSERT INTO send_versions (id, document_id, workspace_id, n, kind, name, mime, size, part_count, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?)`,
    )
    .run(id, documentId, actor.ws, n, kind, name, input.mime.slice(0, 120), input.size, Math.ceil(input.size / PART_BYTES), actor.person, nowIso());
  return (await getDb().prepare('SELECT * FROM send_versions WHERE id = ?').get(id)) as VersionRow;
}

export async function storePart(actor: SendActor, versionId: string, n: number, bytes: Buffer): Promise<void> {
  const { version: v, document } = await versionForActor(actor, versionId);
  if (!canEditDocument(actor, document)) throw new SendError('forbidden', 403);
  if (v.status !== 'uploading') throw new SendError('not_uploading', 409);
  if (!Number.isInteger(n) || n < 0 || n >= v.part_count) throw new SendError('invalid_part', 400);
  if (bytes.length === 0 || bytes.length > PART_BYTES) throw new SendError('invalid_part', 400);
  let ref: string;
  try {
    ref = await storeSendFile(bytes, 'application/octet-stream');
  } catch (err) {
    // Sin dónde guardar no sirve reintentar: la fila queda fallida y se puede borrar.
    if (err instanceof SendError && err.code === 'storage_unavailable') await failVersion(versionId, err.code);
    throw err;
  }
  const db = getDb();
  const old = (await db.prepare('SELECT ref FROM send_version_parts WHERE version_id = ? AND n = ?').get(versionId, n)) as { ref: string } | undefined;
  await db
    .prepare('INSERT INTO send_version_parts (version_id, n, ref, size) VALUES (?, ?, ?, ?) ON CONFLICT (version_id, n) DO UPDATE SET ref = excluded.ref, size = excluded.size')
    .run(versionId, n, ref, bytes.length);
  if (old) await deleteSendFiles([old.ref]).catch(() => undefined);
}

export async function readParts(versionId: string): Promise<Buffer> {
  const parts = (await getDb().prepare('SELECT ref FROM send_version_parts WHERE version_id = ? ORDER BY n').all(versionId)) as Array<{ ref: string }>;
  const out: Buffer[] = [];
  for (const p of parts) {
    const b = await readSendFile(p.ref);
    if (!b) throw new SendError('file_unavailable', 404);
    out.push(b);
  }
  return Buffer.concat(out);
}

/** Bytes [start, end] de un archivo en partes, leyendo solo las que hacen falta. */
export async function readRange(versionId: string, start: number, end: number): Promise<Buffer> {
  const from = Math.floor(start / PART_BYTES);
  const to = Math.floor(end / PART_BYTES);
  const parts = (await getDb()
    .prepare('SELECT n, ref FROM send_version_parts WHERE version_id = ? AND n >= ? AND n <= ? ORDER BY n')
    .all(versionId, from, to)) as Array<{ n: number; ref: string }>;
  const out: Buffer[] = [];
  for (const p of parts) {
    const b = await readSendFile(p.ref);
    if (!b) throw new SendError('file_unavailable', 404);
    const offset = Number(p.n) * PART_BYTES;
    out.push(b.subarray(Math.max(0, start - offset), Math.min(b.length, end - offset + 1)));
  }
  return Buffer.concat(out);
}

/** Termina la subida: valida lo recibido y deja la versión lista para procesar. */
export async function completeUpload(actor: SendActor, versionId: string, input: { durationSec?: number }): Promise<VersionRow> {
  const { version: v, document } = await versionForActor(actor, versionId);
  if (!canEditDocument(actor, document)) throw new SendError('forbidden', 403);
  if (v.status !== 'uploading') return v;
  const db = getDb();
  const parts = (await db.prepare('SELECT n, ref, size FROM send_version_parts WHERE version_id = ? ORDER BY n').all(versionId)) as Array<{ n: number; ref: string; size: number }>;
  const total = parts.reduce((s, p) => s + Number(p.size), 0);
  if (parts.length !== v.part_count || total !== Number(v.size)) throw new SendError('upload_incomplete', 409);
  const head = await readSendFile(parts[0].ref);
  const kind = head ? sniffKind(head.subarray(0, 2048), v.name, v.mime) : null;
  if (!kind || kind !== v.kind) {
    await failVersion(v.id, 'content_mismatch');
    throw new SendError('content_mismatch', 415);
  }
  if (kind === 'video') {
    const duration = Math.min(86_400, Math.max(1, Math.ceil(input.durationSec ?? 0)));
    if (!input.durationSec || !Number.isFinite(input.durationSec)) {
      await failVersion(v.id, 'video_unreadable');
      throw new SendError('video_unreadable', 422);
    }
    const { bucketSec, pages } = videoBuckets(duration);
    const res = await db
      .prepare(`UPDATE send_versions SET status = 'ready', duration_sec = ?, bucket_sec = ?, page_count = ?, ready_at = ? WHERE id = ? AND status = 'uploading'`)
      .run(duration, bucketSec, pages, nowIso(), v.id);
    if (res.changes) await activateVersion(v.document_id, v.id, v.n);
  } else {
    await db.prepare(`UPDATE send_versions SET status = 'processing' WHERE id = ? AND status = 'uploading'`).run(v.id);
  }
  return (await db.prepare('SELECT * FROM send_versions WHERE id = ?').get(v.id)) as VersionRow;
}

async function failVersion(id: string, code: string): Promise<void> {
  await getDb().prepare(`UPDATE send_versions SET status = 'failed', error = ?, render_claimed_at = NULL WHERE id = ?`).run(code, id);
}

/**
 * La versión lista pasa a ser la que muestran los links. Solo avanza: una versión
 * vieja que termina tarde no pisa a una más nueva.
 */
async function activateVersion(documentId: string, versionId: string, n: number): Promise<void> {
  const db = getDb();
  const cur = (await db
    .prepare('SELECT v.n FROM send_documents d LEFT JOIN send_versions v ON v.id = d.current_version_id WHERE d.id = ?')
    .get(documentId)) as { n: number | null } | undefined;
  if (cur?.n !== null && cur?.n !== undefined && Number(cur.n) > n) return;
  await db.prepare('UPDATE send_documents SET current_version_id = ?, updated_at = ? WHERE id = ?').run(versionId, nowIso(), documentId);
}

// ---------- Render ----------

const CLAIM_MS = 90_000;
const MAX_STALLS = 4;
/** Los topes de un PDF de Send: alcanzan para los 100 MB y 500 páginas que promete la app. */
const SEND_PDF_LIMITS = { objects: 2_000_000, stream: 512 * 1024 * 1024, total: 4 * 1024 * 1024 * 1024, render: true };
/** Una subida que no terminó en un día no va a terminar. */
const UPLOAD_TTL_MS = 86_400_000;

export async function storeRenderedPage(versionId: string, page: { page: number; bytes: Buffer; width: number; height: number }): Promise<void> {
  const ref = await storeSendFile(page.bytes, 'image/webp');
  const db = getDb();
  await db
    .prepare('INSERT INTO send_pages (version_id, page, ref, width, height, bytes) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (version_id, page) DO UPDATE SET ref = excluded.ref, width = excluded.width, height = excluded.height, bytes = excluded.bytes')
    .run(versionId, page.page, ref, page.width, page.height, page.bytes.length);
  await db.prepare('UPDATE send_versions SET rendered_count = MAX(rendered_count, ?), render_stalls = 0 WHERE id = ?').run(page.page, versionId);
}

/** PDF de trabajo de una versión: el archivo subido o el que salió de convertirlo. */
async function workingPdf(v: VersionRow): Promise<Buffer> {
  if (v.derived_ref) {
    const b = await readSendFile(v.derived_ref);
    if (!b) throw new SendError('file_unavailable', 404);
    return b;
  }
  const file = await readParts(v.id);
  if (v.kind === 'pdf' || v.kind === 'docs') return file;
  if (v.kind === 'word') {
    await assertOfficeSize(file);
    let blocks;
    try {
      blocks = docxToBlocks(file);
    } catch {
      throw new SendError('office_invalid', 422);
    }
    const title = v.name.replace(/\.docx$/i, '');
    if (needsUnicodeFont(title, blocks)) throw new SendError('office_unicode', 422);
    const pdf = await blocksToPdf(blocks, title);
    const ref = await storeSendFile(pdf, 'application/pdf');
    await getDb().prepare('UPDATE send_versions SET derived_ref = ?, note = ? WHERE id = ?').run(ref, 'simplified', v.id);
    return pdf;
  }
  throw new SendError('unsupported_type', 415);
}

/**
 * Renderiza páginas durante `budgetMs` y deja seguir al próximo pedido. Lo llaman
 * el navegador de quien sube y, si se fue, el cron de cada minuto. La fila se
 * reclama (compare-and-set): dos a la vez no renderizan lo mismo.
 */
export async function pumpRender(versionId: string, budgetMs = 8000): Promise<VersionRow> {
  const db = getDb();
  const now = Date.now();
  const claim = await db
    .prepare(`UPDATE send_versions SET render_claimed_at = ? WHERE id = ? AND status = 'processing' AND (render_claimed_at IS NULL OR render_claimed_at < ?)`)
    .run(now, versionId, now - CLAIM_MS);
  const load = async () => (await db.prepare('SELECT * FROM send_versions WHERE id = ?').get(versionId)) as VersionRow;
  if (!claim.changes) return load();
  // Si el motor no carga en este servidor, el archivo no tiene la culpa: queda en cola, con un motivo, y se reintenta.
  try {
    await loadRenderEngine();
  } catch (err) {
    console.error('[send:render] engine', err instanceof Error ? err.message : 'error');
    await db.prepare('UPDATE send_versions SET error = ? WHERE id = ?').run('render_unavailable', versionId);
    return load();
  }
  const v = await load();
  if (v.error) await db.prepare('UPDATE send_versions SET error = NULL WHERE id = ?').run(v.id);
  const deadline = now + budgetMs;
  // Una página que tumba la función vuelve a reclamarse: sin avance tras varios intentos, se corta con un motivo.
  if (Number(v.render_stalls) >= MAX_STALLS) {
    await failVersion(v.id, 'render_failed');
    return load();
  }
  await db.prepare('UPDATE send_versions SET render_stalls = render_stalls + 1 WHERE id = ?').run(v.id);
  try {
    if (v.kind === 'slides') {
      const file = await readParts(v.id);
      const total = await pptxToImages(file, { skip: Number(v.rendered_count), deadline, onPage: (page) => storeRenderedPage(v.id, page), onTotal: (n) => db.prepare('UPDATE send_versions SET page_count = ?, note = ? WHERE id = ?').run(n, 'simplified', v.id).then(() => undefined) });
      if (!total) throw new SendError('office_invalid', 422);
    } else {
      const pdf = await workingPdf(v);
      const doc = await openPdf(pdf);
      try {
        if (doc.numPages > MAX_PAGES) throw new SendError('too_many_pages', 422);
        if (doc.numPages < 1) throw new SendError('pdf_invalid', 422);
        // Una vez, ya sabiendo que abre: una contraseña se informa como tal.
        if (Number(v.rendered_count) === 0) {
          try {
            guardPdf(pdf, SEND_PDF_LIMITS);
          } catch {
            throw new SendError('pdf_too_complex', 422);
          }
        }
        if (Number(v.page_count) !== doc.numPages) await db.prepare('UPDATE send_versions SET page_count = ? WHERE id = ?').run(doc.numPages, v.id);
        let next = Number(v.rendered_count) + 1;
        while (next <= doc.numPages && Date.now() < deadline) {
          await storeRenderedPage(v.id, await doc.renderPage(next));
          next++;
          // Entre página y página, le deja lugar al resto de los pedidos.
          await new Promise((r) => setImmediate(r));
        }
      } finally {
        await doc.close();
      }
    }
    const after = await load();
    if (Number(after.rendered_count) >= Number(after.page_count) && Number(after.page_count) > 0) {
      const res = await db.prepare(`UPDATE send_versions SET status = 'ready', ready_at = ?, render_claimed_at = NULL, render_stalls = 0 WHERE id = ? AND status = 'processing'`).run(nowIso(), v.id);
      if (res.changes) await activateVersion(v.document_id, v.id, v.n);
    } else {
      await db.prepare('UPDATE send_versions SET render_claimed_at = NULL WHERE id = ?').run(v.id);
    }
  } catch (err) {
    if (err instanceof SendError && err.code === 'render_unavailable') {
      await db.prepare('UPDATE send_versions SET error = ?, render_stalls = 0 WHERE id = ?').run(err.code, v.id);
      return load();
    }
    // Lo que no se puede renderizar queda marcado con su motivo.
    const code = err instanceof SendError ? err.code : 'render_failed';
    if (!(err instanceof SendError)) console.error('[send:render]', v.id, err instanceof Error ? err.message : 'error');
    await failVersion(v.id, code);
  }
  return load();
}

/** Errores que no son del archivo: se pueden reintentar. */
export const RETRYABLE_ERRORS = ['render_failed', 'render_unavailable', 'file_unavailable'];

/** Reintentar a mano una versión que falló por el servidor. */
export async function retryVersion(versionId: string): Promise<void> {
  await getDb()
    .prepare(`UPDATE send_versions SET status = 'processing', error = NULL, render_stalls = 0, render_claimed_at = NULL WHERE id = ? AND status = 'failed' AND error IN ('render_failed', 'render_unavailable', 'file_unavailable')`)
    .run(versionId);
}

/** Cron de cada minuto: versiones que quedaron a medio renderizar porque quien subió se fue. */
export async function runSendRenderCron(opts: { budgetMs?: number } = {}): Promise<{ pumped: number }> {
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  const rows = (await getDb()
    .prepare(`SELECT id FROM send_versions WHERE status = 'processing' AND (render_claimed_at IS NULL OR render_claimed_at < ?) ORDER BY created_at LIMIT 10`)
    .all(Date.now() - CLAIM_MS)) as Array<{ id: string }>;
  let pumped = 0;
  for (const r of rows) {
    const left = deadline - Date.now();
    if (left < 1000) break;
    await pumpRender(r.id, Math.min(left, 10_000)).catch(() => null);
    pumped++;
    await new Promise((res) => setImmediate(res));
  }
  return { pumped };
}

/** Cron: sesiones y códigos vencidos, y subidas abandonadas (con sus partes). */
export async function purgeSendLeftovers(): Promise<void> {
  const db = getDb();
  const now = nowIso();
  await db.prepare('DELETE FROM send_page_views WHERE session_id IN (SELECT id FROM send_sessions WHERE expires_at < ?)').run(now);
  await db.prepare('DELETE FROM send_sessions WHERE expires_at < ?').run(now);
  await db.prepare('DELETE FROM send_email_codes WHERE expires_at < ?').run(new Date(Date.now() - 86_400_000).toISOString());
  const stale = (await db
    .prepare(`SELECT id, derived_ref FROM send_versions WHERE status = 'uploading' AND created_at < ? LIMIT 20`)
    .all(new Date(Date.now() - UPLOAD_TTL_MS).toISOString())) as Array<{ id: string; derived_ref: string | null }>;
  for (const v of stale) {
    // Compare-and-set: si otro cron la tomó, no se toca.
    const res = await db.prepare(`UPDATE send_versions SET status = 'failed', error = 'upload_incomplete' WHERE id = ? AND status = 'uploading'`).run(v.id);
    if (res.changes) await purgeVersionFiles(v.id, v.derived_ref);
  }
}

/** Una versión hecha de un PDF ya armado (página de Docs). */
export async function versionFromPdf(actor: SendActor, documentId: string, pdf: Buffer, name: string, kind: VersionKind, sourceRef: string | null): Promise<VersionRow> {
  await assertCanStore(actor.ws, pdf.length);
  const id = newId('sv');
  const n = await nextVersionNumber(documentId);
  const db = getDb();
  const count = Math.max(1, Math.ceil(pdf.length / PART_BYTES));
  await db
    .prepare(
      `INSERT INTO send_versions (id, document_id, workspace_id, n, kind, name, mime, size, part_count, status, source_ref, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, 'processing', ?, ?, ?)`,
    )
    .run(id, documentId, actor.ws, n, kind, name.slice(0, 200), pdf.length, count, sourceRef, actor.person, nowIso());
  for (let i = 0; i < count; i++) {
    const piece = pdf.subarray(i * PART_BYTES, (i + 1) * PART_BYTES);
    const ref = await storeSendFile(Buffer.from(piece), 'application/pdf');
    await db.prepare('INSERT INTO send_version_parts (version_id, n, ref, size) VALUES (?, ?, ?, ?)').run(id, i, ref, piece.length);
  }
  return (await db.prepare('SELECT * FROM send_versions WHERE id = ?').get(id)) as VersionRow;
}

export async function pageRef(versionId: string, page: number): Promise<{ ref: string; width: number; height: number } | null> {
  const row = (await getDb().prepare('SELECT ref, width, height FROM send_pages WHERE version_id = ? AND page = ?').get(versionId, page)) as
    | { ref: string; width: number; height: number }
    | undefined;
  return row ? { ref: row.ref, width: Number(row.width), height: Number(row.height) } : null;
}

export async function pagesOf(versionId: string): Promise<Array<{ page: number; width: number; height: number }>> {
  const rows = (await getDb().prepare('SELECT page, width, height FROM send_pages WHERE version_id = ? ORDER BY page').all(versionId)) as Array<{ page: number; width: number; height: number }>;
  return rows.map((r) => ({ page: Number(r.page), width: Number(r.width), height: Number(r.height) }));
}

// ---------- Links ----------

export interface LinkInput {
  name?: string;
  recipientEmail?: string | null;
  requireEmail?: boolean;
  verifyEmail?: boolean;
  /** Texto nuevo; null lo saca; undefined no lo toca. */
  passcode?: string | null;
  expiresAt?: string | null;
  allowDownload?: boolean;
  accessMode?: AccessMode;
  accessList?: string[];
  watermark?: boolean;
  ndaTemplateId?: string | null;
  message?: string;
  notify?: boolean;
  useBranding?: boolean;
  disabled?: boolean;
}

export interface LinkDto {
  id: string;
  name: string;
  recipientEmail: string | null;
  path: string | null;
  requireEmail: boolean;
  verifyEmail: boolean;
  hasPasscode: boolean;
  expiresAt: string | null;
  allowDownload: boolean;
  accessMode: AccessMode;
  accessList: string[];
  watermark: boolean;
  ndaTemplateId: string | null;
  message: string;
  notify: boolean;
  useBranding: boolean;
  state: 'active' | 'disabled' | 'expired';
  lastVisitAt: string | null;
  visits: number;
  visitors: number;
  createdAt: string;
  mine: boolean;
}

export function linkDto(l: LinkRow, actor: SendActor, counts: { visits: number; visitors: number } = { visits: 0, visitors: 0 }, canCopy = true): LinkDto {
  // La URL abre sin cuenta: solo la copia quien armó el link, el dueño del documento o un admin.
  const token = canCopy ? openSendValue(l.token_sealed) : null;
  return {
    id: l.id,
    name: l.name,
    recipientEmail: l.recipient_email,
    path: token ? `/send/${token}` : null,
    requireEmail: !!l.require_email,
    verifyEmail: !!l.verify_email,
    hasPasscode: !!l.passcode_hash,
    expiresAt: l.expires_at,
    allowDownload: !!l.allow_download,
    accessMode: l.access_mode,
    accessList: parseAccessList(l.access_list),
    watermark: !!l.watermark,
    ndaTemplateId: l.nda_template_id,
    message: l.message,
    notify: !!l.notify,
    useBranding: !!l.use_branding,
    state: linkState(l),
    lastVisitAt: l.last_visit_at,
    visits: counts.visits,
    visitors: counts.visitors,
    createdAt: l.created_at,
    mine: l.created_by === actor.person,
  };
}

export async function listLinks(actor: SendActor, target: { documentId?: string; spaceId?: string }): Promise<LinkDto[]> {
  const col = target.documentId ? 'document_id' : 'space_id';
  const rows = (await getDb()
    .prepare(`SELECT * FROM send_links WHERE ${col} = ? AND workspace_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`)
    .all(target.documentId ?? target.spaceId ?? '', actor.ws)) as LinkRow[];
  const counts = (await getDb()
    .prepare(
      `SELECT link_id, COUNT(*) AS visits, COUNT(DISTINCT COALESCE(visitor_id, session_id)) AS visitors FROM send_visits
       WHERE link_id IN (SELECT id FROM send_links WHERE ${col} = ?) GROUP BY link_id`,
    )
    .all(target.documentId ?? target.spaceId ?? '')) as Array<{ link_id: string; visits: number; visitors: number }>;
  const by = new Map(counts.map((c) => [c.link_id, { visits: Number(c.visits), visitors: Number(c.visitors) }]));
  const owner = (await getDb()
    .prepare(target.documentId ? 'SELECT owner_id FROM send_documents WHERE id = ?' : 'SELECT owner_id FROM send_spaces WHERE id = ?')
    .get(target.documentId ?? target.spaceId ?? '')) as { owner_id: string } | undefined;
  return rows.map((r) => linkDto(r, actor, by.get(r.id), actor.admin || owner?.owner_id === actor.person || r.created_by === actor.person));
}

function cleanLinkFields(input: LinkInput) {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined) out.name = input.name.trim().slice(0, 120);
  if (input.recipientEmail !== undefined) {
    const email = input.recipientEmail ? normalizeEmail(input.recipientEmail) : null;
    if (input.recipientEmail && !email) throw new SendError('invalid_recipient', 400);
    out.recipient_email = email;
  }
  if (input.requireEmail !== undefined) out.require_email = input.requireEmail ? 1 : 0;
  if (input.verifyEmail !== undefined) out.verify_email = input.verifyEmail ? 1 : 0;
  if (input.expiresAt !== undefined) {
    if (input.expiresAt) {
      const d = new Date(input.expiresAt);
      if (Number.isNaN(d.getTime())) throw new SendError('invalid_expiry', 400);
      out.expires_at = d.toISOString();
    } else out.expires_at = null;
  }
  if (input.allowDownload !== undefined) out.allow_download = input.allowDownload ? 1 : 0;
  if (input.accessMode !== undefined) out.access_mode = input.accessMode;
  if (input.accessList !== undefined) {
    const { entries, invalid } = cleanAccessList(input.accessList);
    if (invalid.length) throw new SendError('invalid_access_entry', 400, { entry: invalid[0].slice(0, 80) });
    out.access_list = JSON.stringify(entries);
  }
  if (input.watermark !== undefined) out.watermark = input.watermark ? 1 : 0;
  if (input.ndaTemplateId !== undefined) out.nda_template_id = input.ndaTemplateId || null;
  if (input.message !== undefined) out.message = input.message.slice(0, 1000);
  if (input.notify !== undefined) out.notify = input.notify ? 1 : 0;
  if (input.useBranding !== undefined) out.use_branding = input.useBranding ? 1 : 0;
  return out;
}

async function passcodeHash(passcode: string): Promise<string> {
  const p = passcode.trim();
  if (p.length < 4 || p.length > 100) throw new SendError('invalid_passcode', 400);
  return hashPassword(p);
}

/** Crea un link. Es una URL que funciona sin cuenta: se hace desde la web (lib/mcp/excludes.mjs). */
export async function createLink(actor: SendActor, target: { documentId?: string; spaceId?: string }, input: LinkInput): Promise<LinkRow> {
  const fields = cleanLinkFields(input);
  if (input.accessMode && input.accessMode !== 'none' && (fields.access_list === '[]' || !fields.access_list)) throw new SendError('empty_access_list', 400);
  const id = newId('sl');
  const token = newToken();
  const ts = nowIso();
  const passcode = input.passcode ? await passcodeHash(input.passcode) : null;
  await getDb()
    .prepare(
      `INSERT INTO send_links (id, workspace_id, document_id, space_id, created_by, name, recipient_email, token_hash, token_sealed, require_email, verify_email,
         passcode_hash, expires_at, allow_download, access_mode, access_list, watermark, nda_template_id, message, notify, use_branding, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      actor.ws,
      target.documentId ?? null,
      target.spaceId ?? null,
      actor.person,
      (fields.name as string) || '',
      (fields.recipient_email as string | null) ?? null,
      hashToken(token),
      sealSendValue(token),
      (fields.require_email as number) ?? 0,
      (fields.verify_email as number) ?? 0,
      passcode,
      (fields.expires_at as string | null) ?? null,
      (fields.allow_download as number) ?? 0,
      (fields.access_mode as string) ?? 'none',
      (fields.access_list as string) ?? '[]',
      (fields.watermark as number) ?? 0,
      (fields.nda_template_id as string | null) ?? null,
      (fields.message as string) ?? '',
      (fields.notify as number) ?? 1,
      (fields.use_branding as number) ?? 1,
      ts,
      ts,
    );
  return (await getDb().prepare('SELECT * FROM send_links WHERE id = ?').get(id)) as LinkRow;
}

export async function getLink(actor: SendActor, id: string): Promise<LinkRow> {
  const row = (await getDb().prepare('SELECT * FROM send_links WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(id, actor.ws)) as LinkRow | undefined;
  if (!row) throw new SendError('not_found', 404);
  return row;
}

/** ¿Quien llama puede cambiar este link? El que lo hizo, el dueño del documento o espacio, o un admin. */
export async function requireEditLink(actor: SendActor, id: string): Promise<LinkRow> {
  const l = await getLink(actor, id);
  if (l.document_id) {
    const d = await getDocument(actor, l.document_id);
    if (actor.admin || d.owner_id === actor.person || l.created_by === actor.person) return l;
  } else if (l.space_id) {
    const s = (await getDb().prepare('SELECT owner_id, sharing FROM send_spaces WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(l.space_id, actor.ws)) as
      | { owner_id: string; sharing: string }
      | undefined;
    if (!s) throw new SendError('not_found', 404);
    if (actor.admin || s.owner_id === actor.person || l.created_by === actor.person) return l;
  }
  throw new SendError('forbidden', 403);
}

/** Cambios que obligan a pasar de nuevo por los pasos del link a quien ya entró. */
const GATE_FIELDS = ['require_email', 'verify_email', 'access_mode', 'access_list', 'nda_template_id', 'watermark'];

export async function updateLink(actor: SendActor, id: string, input: LinkInput): Promise<LinkRow> {
  const cur = await requireEditLink(actor, id);
  const fields = cleanLinkFields(input);
  const mode = (fields.access_mode as string | undefined) ?? cur.access_mode;
  const list = (fields.access_list as string | undefined) ?? cur.access_list;
  if (mode !== 'none' && list === '[]') throw new SendError('empty_access_list', 400);
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  let reGate = false;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    args.push(v as string | number | null);
    if (GATE_FIELDS.includes(k) && v !== (cur as unknown as Record<string, unknown>)[k]) reGate = true;
  }
  if (input.passcode !== undefined && (input.passcode || cur.passcode_hash)) {
    sets.push('passcode_hash = ?');
    args.push(input.passcode ? await passcodeHash(input.passcode) : null);
    reGate = true;
  }
  if (input.disabled !== undefined) {
    sets.push('disabled_at = ?');
    args.push(input.disabled ? nowIso() : null);
    // Volver a prenderlo no revive a quien ya había entrado: pasa de nuevo por los pasos.
    if (!input.disabled && cur.disabled_at) reGate = true;
  }
  if (fields.expires_at !== undefined && linkState({ disabled_at: null, expires_at: cur.expires_at }) === 'expired') reGate = true;
  if (reGate) sets.push('access_epoch = access_epoch + 1');
  if (sets.length) {
    await getDb()
      .prepare(`UPDATE send_links SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...args, nowIso(), id);
  }
  return (await getDb().prepare('SELECT * FROM send_links WHERE id = ?').get(id)) as LinkRow;
}

export async function deleteLink(actor: SendActor, id: string): Promise<void> {
  await requireEditLink(actor, id);
  const ts = nowIso();
  // Se conservan las visitas de un link borrado: siguen contando en los números del documento.
  const db = getDb();
  await db.prepare('UPDATE send_links SET deleted_at = ?, disabled_at = COALESCE(disabled_at, ?), updated_at = ? WHERE id = ?').run(ts, ts, ts, id);
  const copies = (await db.prepare('SELECT refs FROM send_download_cache WHERE session_id IN (SELECT id FROM send_sessions WHERE link_id = ?)').all(id)) as Array<{ refs: string }>;
  await deleteSendFiles(copies.flatMap((c) => storeRefsOf(c.refs))).catch(() => undefined);
  await db.prepare('DELETE FROM send_download_cache WHERE session_id IN (SELECT id FROM send_sessions WHERE link_id = ?)').run(id);
  await db.prepare('DELETE FROM send_sessions WHERE link_id = ?').run(id);
}

// ---------- Marca ----------

export interface SendBranding {
  brandName: string;
  logoUrl: string;
  brandColor: string;
  siteUrl: string;
}

export async function getBranding(workspaceId: string): Promise<SendBranding> {
  const r = (await getDb().prepare('SELECT brand_name, logo_url, brand_color, site_url FROM send_settings WHERE workspace_id = ?').get(workspaceId)) as
    | { brand_name: string; logo_url: string; brand_color: string; site_url: string }
    | undefined;
  return { brandName: r?.brand_name ?? '', logoUrl: r?.logo_url ?? '', brandColor: r?.brand_color ?? '', siteUrl: r?.site_url ?? '' };
}

export async function saveBranding(workspaceId: string, b: SendBranding): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO send_settings (workspace_id, brand_name, logo_url, brand_color, site_url, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id) DO UPDATE SET brand_name = excluded.brand_name, logo_url = excluded.logo_url, brand_color = excluded.brand_color, site_url = excluded.site_url, updated_at = excluded.updated_at`,
    )
    .run(workspaceId, b.brandName, b.logoUrl, b.brandColor, b.siteUrl, nowIso());
}
