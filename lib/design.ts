/**
 * Design (como Canva): datos del servidor. Server-only.
 *
 * - Un diseño es de quien lo crea y vive en el workspace (workspace_id = id
 *   del dueño del workspace, como el resto de las apps). Quién lo ve y edita:
 *   lib/design-access.ts.
 * - El JSON (lib/design-model.ts) se guarda entero con un número de versión:
 *   un guardado con una versión vieja no pisa el de otra persona (409).
 * - Carpetas personales, favoritos y recientes por persona; papelera.
 * - Link público de solo lectura (/d/<token>), revocable.
 * - Comentarios fijados en un punto de una página; avisan a quien lo creó y
 *   a quienes participan del hilo.
 * - Archivos (imágenes y logos) en el storage de uploads, servidos por
 *   /api/design/files/<id> a quien la subió, a quien ve un diseño que la usa
 *   (design_file_refs, se escribe al guardar) y, si es un logo del kit, al
 *   workspace.
 */
import { randomBytes } from 'crypto';
import { readFile } from 'fs/promises';
import { getDb } from './db';
import { localUploadPath, saveUpload, UploadError } from './uploads';
import { can, resolveAccess, visibleSql, type DesignAccess, type DesignActor, type DesignLevel, type WorkspaceAccess } from './design-access';
import {
  blankDoc,
  clampSide,
  cloneDoc,
  docBytes,
  docFileIds,
  docSearchText,
  FILE_ID_RE,
  FONT_KEYS,
  isColor,
  MAX_DOC_BYTES,
  parseDoc,
  type DesignDoc,
  type FontKey,
} from './design-model';
import { findTemplate, templateDoc, templateName } from './design-templates';
import { DESIGN_MAX_UPLOAD_BYTES, imageDimensions, sniffDesignImage } from './design-image';
import { likeContains } from './track-views';

export class DesignError extends Error {
  constructor(
    public code: 'not_found' | 'forbidden' | 'invalid_input' | 'conflict' | 'too_large' | 'file_type_not_allowed' | 'storage_unavailable',
    public status: number,
  ) {
    super(code);
    this.name = 'DesignError';
  }
}

export type { DesignActor };

const nowIso = () => new Date().toISOString();
const newKey = (prefix: string) => `${prefix}${randomBytes(12).toString('base64url')}`;

// ---------- Filas ----------

export interface DesignRow {
  id: string;
  workspace_id: string;
  created_by: string;
  folder_id: string | null;
  name: string;
  width: number;
  height: number;
  pages: number;
  doc: string;
  doc_bytes: number;
  search_text: string;
  thumb: string | null;
  version: number;
  workspace_access: WorkspaceAccess;
  share_token: string | null;
  is_template: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DesignSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  pages: number;
  thumb: string | null;
  folderId: string | null;
  createdBy: string;
  ownerName: string;
  access: DesignAccess;
  starred: boolean;
  isTemplate: boolean;
  shared: boolean;
  updatedAt: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface DesignFull extends DesignSummary {
  doc: DesignDoc;
  version: number;
  workspaceAccess: WorkspaceAccess;
  hasLink: boolean;
}

const SUMMARY_COLS = `d.id, d.name, d.width, d.height, d.pages, d.thumb, d.folder_id, d.created_by, d.workspace_access, d.is_template,
  d.updated_at, d.created_at, d.deleted_at, d.share_token,
  COALESCE(NULLIF(u.name, ''), u.email, '') AS owner_name,
  (SELECT m.role FROM design_members m WHERE m.design_id = d.id AND m.user_id = ?) AS my_role,
  EXISTS (SELECT 1 FROM design_stars s WHERE s.design_id = d.id AND s.user_id = ?) AS starred,
  EXISTS (SELECT 1 FROM design_members m2 WHERE m2.design_id = d.id) AS has_members`;

type SummaryRow = Pick<
  DesignRow,
  'id' | 'name' | 'width' | 'height' | 'pages' | 'thumb' | 'folder_id' | 'created_by' | 'workspace_access' | 'is_template' | 'updated_at' | 'created_at' | 'deleted_at' | 'share_token'
> & { owner_name: string; my_role: DesignLevel | null; starred: number; has_members: number };

function toSummary(actor: DesignActor, r: SummaryRow): DesignSummary | null {
  const access = resolveAccess(actor, r, r.my_role);
  if (!access) return null;
  return {
    id: r.id,
    name: r.name,
    width: r.width,
    height: r.height,
    pages: r.pages,
    thumb: r.thumb,
    folderId: r.created_by === actor.personId ? r.folder_id : null,
    createdBy: r.created_by,
    ownerName: r.owner_name,
    access,
    starred: Boolean(r.starred),
    isTemplate: Boolean(r.is_template),
    shared: r.workspace_access !== 'none' || Boolean(r.has_members) || Boolean(r.share_token),
    updatedAt: r.updated_at,
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
  };
}

async function loadRow(ws: string, id: string): Promise<DesignRow | null> {
  return ((await getDb().prepare('SELECT * FROM design_designs WHERE id = ? AND workspace_id = ?').get(id, ws)) as DesignRow | undefined) ?? null;
}

async function memberRole(id: string, personId: string): Promise<DesignLevel | null> {
  const r = (await getDb().prepare('SELECT role FROM design_members WHERE design_id = ? AND user_id = ?').get(id, personId)) as { role: DesignLevel } | undefined;
  return r?.role ?? null;
}

/** Fila + acceso de la persona (null si no existe o no la ve). En la papelera solo la ve quien la creó. */
export async function getDesignAccess(actor: DesignActor, id: string): Promise<{ row: DesignRow; access: DesignAccess } | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const row = await loadRow(actor.ws, id);
  if (!row) return null;
  const access = resolveAccess(actor, row, await memberRole(id, actor.personId));
  if (!access) return null;
  if (row.deleted_at && access !== 'owner') return null;
  return { row, access };
}

async function need(actor: DesignActor, id: string, action: 'view' | 'comment' | 'edit' | 'share' | 'delete') {
  const got = await getDesignAccess(actor, id);
  if (!got) throw new DesignError('not_found', 404);
  if (!can(got.access, action, { admin: actor.admin, isTemplate: Boolean(got.row.is_template) })) throw new DesignError('forbidden', 403);
  return got;
}

export async function getDesign(actor: DesignActor, id: string): Promise<DesignFull | null> {
  const got = await getDesignAccess(actor, id);
  if (!got || got.row.deleted_at) return null;
  const { row, access } = got;
  const owner = (await getDb().prepare("SELECT COALESCE(NULLIF(name, ''), email, '') AS n FROM users WHERE id = ?").get(row.created_by)) as { n: string } | undefined;
  const starred = await getDb().prepare('SELECT 1 AS x FROM design_stars WHERE design_id = ? AND user_id = ?').get(id, actor.personId);
  const members = await getDb().prepare('SELECT 1 AS x FROM design_members WHERE design_id = ? LIMIT 1').get(id);
  const doc = parseDoc(JSON.parse(row.doc)) ?? blankDoc(row.width, row.height);
  return {
    id: row.id,
    name: row.name,
    width: row.width,
    height: row.height,
    pages: row.pages,
    thumb: row.thumb,
    folderId: row.created_by === actor.personId ? row.folder_id : null,
    createdBy: row.created_by,
    ownerName: owner?.n ?? '',
    access,
    starred: Boolean(starred),
    isTemplate: Boolean(row.is_template),
    shared: row.workspace_access !== 'none' || Boolean(members) || Boolean(row.share_token),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    doc,
    version: row.version,
    workspaceAccess: row.workspace_access,
    hasLink: Boolean(row.share_token),
  };
}

// ---------- Lista ----------

export type DesignView = 'recent' | 'mine' | 'shared' | 'starred' | 'templates' | 'trash' | 'folder';

export async function listDesigns(
  actor: DesignActor,
  opts: { view?: DesignView; folderId?: string | null; q?: string; limit?: number } = {},
): Promise<DesignSummary[]> {
  const view = opts.view ?? 'recent';
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const vis = visibleSql('d');
  const where: string[] = ['d.workspace_id = ?'];
  const args: Array<string | number> = [actor.personId, actor.personId, actor.ws];
  if (view === 'trash') {
    where.push('d.deleted_at IS NOT NULL', 'd.created_by = ?');
    args.push(actor.personId);
  } else {
    where.push('d.deleted_at IS NULL', vis.sql);
    args.push(...vis.argsFor(actor.personId));
  }
  let order = 'd.updated_at DESC';
  switch (view) {
    case 'recent':
      where.push('d.is_template = 0', '(d.created_by = ? OR EXISTS (SELECT 1 FROM design_opens o WHERE o.design_id = d.id AND o.user_id = ?))');
      args.push(actor.personId, actor.personId);
      order = `MAX(COALESCE((SELECT o.opened_at FROM design_opens o WHERE o.design_id = d.id AND o.user_id = ?), ''), d.updated_at) DESC`;
      break;
    case 'mine':
      where.push('d.is_template = 0', 'd.created_by = ?');
      args.push(actor.personId);
      break;
    case 'shared':
      where.push('d.is_template = 0', 'd.created_by != ?');
      args.push(actor.personId);
      break;
    case 'starred':
      where.push('EXISTS (SELECT 1 FROM design_stars s WHERE s.design_id = d.id AND s.user_id = ?)');
      args.push(actor.personId);
      break;
    case 'templates':
      where.push('d.is_template = 1');
      order = 'd.name COLLATE NOCASE ASC';
      break;
    case 'folder':
      where.push('d.folder_id = ?', 'd.created_by = ?');
      args.push(opts.folderId ?? '', actor.personId);
      break;
    case 'trash':
      order = 'd.deleted_at DESC';
      break;
  }
  const q = (opts.q ?? '').trim();
  if (q) {
    const like = likeContains(q);
    where.push("(d.name LIKE ? ESCAPE '\\' OR d.search_text LIKE ? ESCAPE '\\')");
    args.push(like, like);
  }
  const orderArgs = view === 'recent' ? [actor.personId] : [];
  const rows = (await getDb()
    .prepare(`SELECT ${SUMMARY_COLS} FROM design_designs d LEFT JOIN users u ON u.id = d.created_by WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`)
    .all(...args, ...orderArgs, limit)) as SummaryRow[];
  return rows.map((r) => toSummary(actor, r)).filter((x): x is DesignSummary => x !== null);
}

/** Cmd+K: diseños y carpetas por nombre (y texto adentro), con el alcance de la lista. */
export async function searchDesigns(actor: DesignActor, q: string, limit = 5): Promise<Array<{ id: string; kind: 'design' | 'folder'; label: string; meta: string }>> {
  const needle = q.trim();
  if (!needle) return [];
  const vis = visibleSql('d');
  const like = likeContains(needle);
  const rows = (await getDb()
    .prepare(
      `SELECT d.id, d.name, d.width, d.height, d.is_template FROM design_designs d
       WHERE d.workspace_id = ? AND d.deleted_at IS NULL AND ${vis.sql} AND (d.name LIKE ? ESCAPE '\\' OR d.search_text LIKE ? ESCAPE '\\')
       ORDER BY (d.name LIKE ? ESCAPE '\\') DESC, d.updated_at DESC LIMIT ?`,
    )
    .all(actor.ws, ...vis.argsFor(actor.personId), like, like, like, limit)) as Array<{ id: string; name: string; width: number; height: number; is_template: number }>;
  const folders = (await getDb()
    .prepare(`SELECT id, name FROM design_folders WHERE workspace_id = ? AND created_by = ? AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?`)
    .all(actor.ws, actor.personId, like, limit)) as Array<{ id: string; name: string }>;
  return [
    ...rows.map((r) => ({ id: r.id, kind: 'design' as const, label: r.name, meta: `${r.width} × ${r.height}` })),
    ...folders.map((f) => ({ id: f.id, kind: 'folder' as const, label: f.name, meta: '' })),
  ];
}

// ---------- Crear y guardar ----------

function cleanName(name: string | undefined, fallback: string): string {
  const n = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return n || fallback;
}

async function insertDesign(
  actor: DesignActor,
  input: { name: string; doc: DesignDoc; folderId?: string | null; isTemplate?: boolean; thumb?: string | null },
): Promise<string> {
  const id = newKey('d');
  const now = nowIso();
  const json = JSON.stringify(input.doc);
  if (json.length > MAX_DOC_BYTES) throw new DesignError('too_large', 413);
  await assertFilesReadable(actor, input.doc, null);
  const folderId = input.folderId ? await ownFolderId(actor, input.folderId) : null;
  await getDb()
    .prepare(
      `INSERT INTO design_designs (id, workspace_id, created_by, folder_id, name, width, height, pages, doc, doc_bytes, search_text, thumb, version, is_template, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .run(
      id,
      actor.ws,
      actor.personId,
      folderId,
      input.name,
      input.doc.width,
      input.doc.height,
      input.doc.pages.length,
      json,
      docBytes(input.doc),
      docSearchText(input.doc),
      cleanThumb(input.thumb) ?? null,
      input.isTemplate ? 1 : 0,
      actor.personId,
      now,
      now,
    );
  await writeFileRefs(id, input.doc);
  return id;
}

export interface CreateDesignInput {
  name?: string;
  width?: number;
  height?: number;
  /** Plantilla de la app (id) o de la workspace ("w:<id de diseño>"). */
  template?: string;
  folderId?: string | null;
  locale?: string;
  /** Nombre por defecto en el idioma de quien crea. */
  untitled?: string;
}

export async function createDesign(actor: DesignActor, input: CreateDesignInput): Promise<string> {
  const untitled = input.untitled || 'Untitled design';
  if (input.template?.startsWith('w:')) {
    const src = await need(actor, input.template.slice(2), 'view');
    if (!src.row.is_template) throw new DesignError('not_found', 404);
    const doc = parseDoc(JSON.parse(src.row.doc));
    if (!doc) throw new DesignError('invalid_input', 400);
    return insertDesign(actor, { name: cleanName(input.name, src.row.name), doc: cloneDoc(doc), folderId: input.folderId, thumb: src.row.thumb });
  }
  if (input.template) {
    const t = findTemplate(input.template);
    if (!t) throw new DesignError('not_found', 404);
    return insertDesign(actor, { name: cleanName(input.name, templateName(t, input.locale ?? 'en')), doc: templateDoc(t, input.locale ?? 'en'), folderId: input.folderId });
  }
  const w = clampSide(Number(input.width));
  const h = clampSide(Number(input.height));
  return insertDesign(actor, { name: cleanName(input.name, untitled), doc: blankDoc(w, h), folderId: input.folderId });
}

/** Copia (también de diseños de otros que la persona ve). Queda privada y de quien duplica. */
export async function duplicateDesign(actor: DesignActor, id: string, name?: string): Promise<string> {
  const { row } = await need(actor, id, 'view');
  const doc = parseDoc(JSON.parse(row.doc));
  if (!doc) throw new DesignError('invalid_input', 400);
  return insertDesign(actor, {
    name: cleanName(name, `${row.name} (copy)`),
    doc: cloneDoc(doc),
    folderId: row.created_by === actor.personId ? row.folder_id : null,
    thumb: row.thumb,
  });
}

/**
 * Guarda una copia como plantilla del workspace, que ve todo el workspace:
 * solo owner/admins, y sobre un diseño que pueden editar (con acceso de
 * lectura no se publica un diseño privado).
 */
export async function saveAsTemplate(actor: DesignActor, id: string, name?: string): Promise<string> {
  const { row } = await need(actor, id, 'edit');
  if (!actor.admin) throw new DesignError('forbidden', 403);
  const doc = parseDoc(JSON.parse(row.doc));
  if (!doc) throw new DesignError('invalid_input', 400);
  return insertDesign(actor, { name: cleanName(name, row.name), doc: cloneDoc(doc), isTemplate: true, thumb: row.thumb });
}

const THUMB_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export const MAX_THUMB_CHARS = 300_000;

export function cleanThumb(thumb: unknown): string | null | undefined {
  if (thumb === undefined) return undefined;
  if (thumb === null) return null;
  return typeof thumb === 'string' && thumb.length <= MAX_THUMB_CHARS && THUMB_RE.test(thumb) ? thumb : undefined;
}

export type SaveDocResult = { ok: true; version: number; updatedAt: string } | { ok: false; code: 'conflict'; version: number; updatedByName: string };

/** Guarda el diseño si nadie guardó desde `baseVersion`. */
export async function saveDesignDoc(actor: DesignActor, id: string, rawDoc: unknown, baseVersion: number, thumb?: unknown): Promise<SaveDocResult> {
  await need(actor, id, 'edit');
  const doc = parseDoc(rawDoc);
  if (!doc) throw new DesignError(JSON.stringify(rawDoc ?? null).length > MAX_DOC_BYTES ? 'too_large' : 'invalid_input', JSON.stringify(rawDoc ?? null).length > MAX_DOC_BYTES ? 413 : 400);
  await assertFilesReadable(actor, doc, id);
  const json = JSON.stringify(doc);
  const now = nowIso();
  const t = cleanThumb(thumb);
  const res = await getDb()
    .prepare(
      `UPDATE design_designs SET doc = ?, doc_bytes = ?, width = ?, height = ?, pages = ?, search_text = ?, version = version + 1, updated_at = ?, updated_by = ?
       ${t !== undefined ? ', thumb = ?' : ''}
       WHERE id = ? AND workspace_id = ? AND version = ? AND deleted_at IS NULL`,
    )
    .run(
      json,
      json.length,
      doc.width,
      doc.height,
      doc.pages.length,
      docSearchText(doc),
      now,
      actor.personId,
      ...(t !== undefined ? [t] : []),
      id,
      actor.ws,
      Math.trunc(baseVersion),
    );
  if (res.changes > 0) {
    await writeFileRefs(id, doc);
    return { ok: true, version: Math.trunc(baseVersion) + 1, updatedAt: now };
  }
  const cur = (await getDb()
    .prepare("SELECT d.version, COALESCE(NULLIF(u.name, ''), u.email, '') AS n FROM design_designs d LEFT JOIN users u ON u.id = d.updated_by WHERE d.id = ?")
    .get(id)) as { version: number; n: string } | undefined;
  if (!cur) throw new DesignError('not_found', 404);
  return { ok: false, code: 'conflict', version: cur.version, updatedByName: cur.n };
}

/** Solo la miniatura (sin tocar la versión): el editor la arma al abrir un diseño que no tiene. */
export async function setDesignThumb(actor: DesignActor, id: string, thumb: unknown): Promise<void> {
  await need(actor, id, 'edit');
  const t = cleanThumb(thumb);
  if (!t) throw new DesignError('invalid_input', 400);
  await getDb().prepare('UPDATE design_designs SET thumb = ? WHERE id = ? AND workspace_id = ?').run(t, id, actor.ws);
}

export async function renameDesign(actor: DesignActor, id: string, name: string): Promise<void> {
  await need(actor, id, 'edit');
  const clean = cleanName(name, '');
  if (!clean) throw new DesignError('invalid_input', 400);
  await getDb().prepare('UPDATE design_designs SET name = ?, updated_at = ? WHERE id = ? AND workspace_id = ?').run(clean, nowIso(), id, actor.ws);
}

export async function moveDesign(actor: DesignActor, id: string, folderId: string | null): Promise<void> {
  const { row } = await need(actor, id, 'view');
  if (row.created_by !== actor.personId) throw new DesignError('forbidden', 403);
  const target = folderId ? await ownFolderId(actor, folderId) : null;
  if (folderId && !target) throw new DesignError('not_found', 404);
  await getDb().prepare('UPDATE design_designs SET folder_id = ? WHERE id = ? AND workspace_id = ?').run(target, id, actor.ws);
}

export async function setStar(actor: DesignActor, id: string, on: boolean): Promise<void> {
  await need(actor, id, 'view');
  if (on) await getDb().prepare('INSERT OR IGNORE INTO design_stars (design_id, user_id, created_at) VALUES (?, ?, ?)').run(id, actor.personId, nowIso());
  else await getDb().prepare('DELETE FROM design_stars WHERE design_id = ? AND user_id = ?').run(id, actor.personId);
}

export async function markOpened(actor: DesignActor, id: string): Promise<void> {
  await getDb()
    .prepare('INSERT INTO design_opens (design_id, user_id, opened_at) VALUES (?, ?, ?) ON CONFLICT(design_id, user_id) DO UPDATE SET opened_at = excluded.opened_at')
    .run(id, actor.personId, nowIso());
}

export async function trashDesign(actor: DesignActor, id: string): Promise<void> {
  await need(actor, id, 'delete');
  // En la papelera el link público deja de andar.
  await getDb().prepare('UPDATE design_designs SET deleted_at = ?, share_token = NULL WHERE id = ? AND workspace_id = ?').run(nowIso(), id, actor.ws);
}

export async function restoreDesign(actor: DesignActor, id: string): Promise<void> {
  const got = await getDesignAccess(actor, id);
  if (!got || got.access !== 'owner') throw new DesignError('not_found', 404);
  await getDb().prepare('UPDATE design_designs SET deleted_at = NULL WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
}

export async function purgeDesign(actor: DesignActor, id: string): Promise<void> {
  const got = await getDesignAccess(actor, id);
  if (!got || got.access !== 'owner' || !got.row.deleted_at) throw new DesignError('not_found', 404);
  const db = getDb();
  for (const t of ['design_members', 'design_stars', 'design_opens', 'design_comments', 'design_presence', 'design_file_refs']) {
    await db.prepare(`DELETE FROM ${t} WHERE design_id = ?`).run(id);
  }
  await db.prepare('DELETE FROM design_designs WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
}

// ---------- Carpetas (personales) ----------

export interface DesignFolder {
  id: string;
  name: string;
  count: number;
}

async function ownFolderId(actor: DesignActor, id: string): Promise<string | null> {
  const r = await getDb().prepare('SELECT id FROM design_folders WHERE id = ? AND workspace_id = ? AND created_by = ?').get(id, actor.ws, actor.personId);
  return r ? id : null;
}

export async function listFolders(actor: DesignActor): Promise<DesignFolder[]> {
  return (await getDb()
    .prepare(
      `SELECT f.id, f.name, (SELECT COUNT(*) FROM design_designs d WHERE d.folder_id = f.id AND d.deleted_at IS NULL) AS count
       FROM design_folders f WHERE f.workspace_id = ? AND f.created_by = ? ORDER BY f.name COLLATE NOCASE`,
    )
    .all(actor.ws, actor.personId)) as DesignFolder[];
}

export async function createFolder(actor: DesignActor, name: string): Promise<DesignFolder> {
  const clean = cleanName(name, '');
  if (!clean) throw new DesignError('invalid_input', 400);
  const id = newKey('fo');
  const now = nowIso();
  await getDb().prepare('INSERT INTO design_folders (id, workspace_id, created_by, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, actor.ws, actor.personId, clean, now, now);
  return { id, name: clean, count: 0 };
}

export async function renameFolder(actor: DesignActor, id: string, name: string): Promise<void> {
  const clean = cleanName(name, '');
  if (!clean) throw new DesignError('invalid_input', 400);
  if (!(await ownFolderId(actor, id))) throw new DesignError('not_found', 404);
  await getDb().prepare('UPDATE design_folders SET name = ?, updated_at = ? WHERE id = ?').run(clean, nowIso(), id);
}

/** Borra la carpeta; los diseños quedan sueltos (no se borran). */
export async function deleteFolder(actor: DesignActor, id: string): Promise<void> {
  if (!(await ownFolderId(actor, id))) throw new DesignError('not_found', 404);
  await getDb().prepare('UPDATE design_designs SET folder_id = NULL WHERE folder_id = ?').run(id);
  await getDb().prepare('DELETE FROM design_folders WHERE id = ?').run(id);
}

// ---------- Compartir ----------

export interface DesignShareInfo {
  workspaceAccess: WorkspaceAccess;
  token: string | null;
  members: Array<{ userId: string; name: string; email: string; role: DesignLevel }>;
  ownerId: string;
  canShare: boolean;
  /** Prender, apagar o renovar el link público: quien lo creó y owner/admins. */
  canLink: boolean;
}

export async function getShare(actor: DesignActor, id: string): Promise<DesignShareInfo> {
  const { row, access } = await need(actor, id, 'view');
  const members = (await getDb()
    .prepare(
      `SELECT m.user_id AS userId, COALESCE(NULLIF(u.name, ''), u.email, '') AS name, COALESCE(u.email, '') AS email, m.role
       FROM design_members m LEFT JOIN users u ON u.id = m.user_id WHERE m.design_id = ? ORDER BY m.created_at`,
    )
    .all(id)) as DesignShareInfo['members'];
  const canShare = can(access, 'share');
  const canLink = canShare && (access === 'owner' || actor.admin);
  return { workspaceAccess: row.workspace_access, token: canShare ? row.share_token : null, members, ownerId: row.created_by, canShare, canLink };
}

export interface ShareUpdate {
  workspaceAccess?: WorkspaceAccess;
  /** Lista completa de personas con acceso (reemplaza la anterior). */
  members?: Array<{ userId: string; role: DesignLevel }>;
  link?: 'on' | 'off' | 'reset';
}

/**
 * Cambia el acceso. `allowedPeople`: ids de quienes pueden estar (gente del
 * workspace con acceso a Design); el resto se ignora. Devuelve a quién se sumó
 * (para avisarle).
 */
export async function updateShare(actor: DesignActor, id: string, input: ShareUpdate, allowedPeople: Set<string>): Promise<{ added: string[] }> {
  const { row, access } = await need(actor, id, 'share');
  // Editar incluye compartir (como Canva), pero el link público lo manejan quien lo creó y owner/admins.
  if (input.link && access !== 'owner' && !actor.admin) throw new DesignError('forbidden', 403);
  const db = getDb();
  if (input.workspaceAccess) {
    await db.prepare('UPDATE design_designs SET workspace_access = ? WHERE id = ?').run(input.workspaceAccess, id);
  }
  if (input.link === 'off') await db.prepare('UPDATE design_designs SET share_token = NULL WHERE id = ?').run(id);
  if (input.link === 'reset' || (input.link === 'on' && !row.share_token)) {
    await db.prepare('UPDATE design_designs SET share_token = ? WHERE id = ?').run(randomBytes(18).toString('base64url'), id);
  }
  const added: string[] = [];
  if (input.members) {
    const before = new Set(((await db.prepare('SELECT user_id FROM design_members WHERE design_id = ?').all(id)) as Array<{ user_id: string }>).map((r) => r.user_id));
    const next = new Map<string, DesignLevel>();
    for (const m of input.members.slice(0, 200)) {
      if (m.userId === row.created_by || !allowedPeople.has(m.userId)) continue;
      next.set(m.userId, m.role === 'edit' ? 'edit' : 'view');
    }
    const now = nowIso();
    for (const uid of before) if (!next.has(uid)) await db.prepare('DELETE FROM design_members WHERE design_id = ? AND user_id = ?').run(id, uid);
    for (const [uid, role] of next) {
      await db
        .prepare('INSERT INTO design_members (design_id, user_id, role, added_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(design_id, user_id) DO UPDATE SET role = excluded.role')
        .run(id, uid, role, actor.personId, now);
      if (!before.has(uid)) added.push(uid);
    }
  }
  return { added };
}

/** Diseño publicado con link (para /d/<token> y sus imágenes). */
export async function getPublicDesign(token: string): Promise<{ row: DesignRow; doc: DesignDoc } | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const row = (await getDb().prepare('SELECT * FROM design_designs WHERE share_token = ? AND deleted_at IS NULL').get(token)) as DesignRow | undefined;
  if (!row) return null;
  const doc = parseDoc(JSON.parse(row.doc));
  return doc ? { row, doc } : null;
}

// ---------- Comentarios ----------

export interface DesignComment {
  id: string;
  pageId: string;
  x: number;
  y: number;
  parentId: string | null;
  authorId: string;
  authorName: string;
  body: string;
  resolved: boolean;
  createdAt: string;
  mine: boolean;
}

export async function listComments(actor: DesignActor, id: string): Promise<DesignComment[]> {
  await need(actor, id, 'view');
  const rows = (await getDb()
    .prepare('SELECT * FROM design_comments WHERE design_id = ? ORDER BY created_at ASC LIMIT 1000')
    .all(id)) as Array<{ id: string; page_id: string; x: number; y: number; parent_id: string | null; author_id: string; author_name: string; body: string; resolved_at: string | null; created_at: string }>;
  return rows.map((r) => ({
    id: r.id,
    pageId: r.page_id,
    x: r.x,
    y: r.y,
    parentId: r.parent_id,
    authorId: r.author_id,
    authorName: r.author_name,
    body: r.body,
    resolved: Boolean(r.resolved_at),
    createdAt: r.created_at,
    mine: r.author_id === actor.personId,
  }));
}

export async function addComment(
  actor: DesignActor,
  id: string,
  input: { pageId: string; x: number; y: number; body: string; parentId?: string | null },
): Promise<{ comment: DesignComment; notify: string[]; designName: string }> {
  const { row } = await need(actor, id, 'comment');
  const body = input.body.trim().slice(0, 2000);
  if (!body) throw new DesignError('invalid_input', 400);
  let parent: { id: string; page_id: string; x: number; y: number; author_id: string } | undefined;
  if (input.parentId) {
    parent = (await getDb().prepare('SELECT id, page_id, x, y, author_id FROM design_comments WHERE id = ? AND design_id = ? AND parent_id IS NULL').get(input.parentId, id)) as typeof parent;
    if (!parent) throw new DesignError('not_found', 404);
  }
  const cid = newKey('c');
  const now = nowIso();
  const pageId = parent?.page_id ?? String(input.pageId).slice(0, 64);
  const x = parent?.x ?? Math.max(0, Math.min(row.width, Number(input.x) || 0));
  const y = parent?.y ?? Math.max(0, Math.min(row.height, Number(input.y) || 0));
  await getDb()
    .prepare(
      'INSERT INTO design_comments (id, design_id, page_id, x, y, parent_id, author_id, author_name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(cid, id, pageId, x, y, parent?.id ?? null, actor.personId, actor.name.slice(0, 120), body, now, now);
  // A quién avisar: quien creó el diseño y quienes participan del hilo (menos quien comenta).
  const notify = new Set<string>([row.created_by]);
  if (parent) {
    notify.add(parent.author_id);
    const others = (await getDb().prepare('SELECT DISTINCT author_id FROM design_comments WHERE parent_id = ?').all(parent.id)) as Array<{ author_id: string }>;
    for (const o of others) notify.add(o.author_id);
  }
  notify.delete(actor.personId);
  // Solo quienes todavía tienen acceso al diseño.
  const allowed: string[] = [];
  for (const uid of notify) {
    if (resolveAccess({ personId: uid, admin: false }, row, await memberRole(id, uid))) allowed.push(uid);
  }
  return {
    comment: { id: cid, pageId, x, y, parentId: parent?.id ?? null, authorId: actor.personId, authorName: actor.name, body, resolved: false, createdAt: now, mine: true },
    notify: allowed,
    designName: row.name,
  };
}

export async function updateComment(actor: DesignActor, id: string, cid: string, input: { resolved?: boolean; body?: string }): Promise<void> {
  const { access } = await need(actor, id, 'comment');
  const c = (await getDb().prepare('SELECT author_id FROM design_comments WHERE id = ? AND design_id = ?').get(cid, id)) as { author_id: string } | undefined;
  if (!c) throw new DesignError('not_found', 404);
  if (input.body !== undefined) {
    if (c.author_id !== actor.personId) throw new DesignError('forbidden', 403);
    const body = input.body.trim().slice(0, 2000);
    if (!body) throw new DesignError('invalid_input', 400);
    await getDb().prepare('UPDATE design_comments SET body = ?, updated_at = ? WHERE id = ?').run(body, nowIso(), cid);
  }
  if (input.resolved !== undefined) {
    // Resolver: quien comentó o quien puede editar.
    if (c.author_id !== actor.personId && !can(access, 'edit')) throw new DesignError('forbidden', 403);
    await getDb()
      .prepare('UPDATE design_comments SET resolved_at = ?, resolved_by = ? WHERE id = ?')
      .run(input.resolved ? nowIso() : null, input.resolved ? actor.personId : null, cid);
  }
}

export async function deleteComment(actor: DesignActor, id: string, cid: string): Promise<void> {
  const { access } = await need(actor, id, 'comment');
  const c = (await getDb().prepare('SELECT author_id FROM design_comments WHERE id = ? AND design_id = ?').get(cid, id)) as { author_id: string } | undefined;
  if (!c) throw new DesignError('not_found', 404);
  if (c.author_id !== actor.personId && access !== 'owner') throw new DesignError('forbidden', 403);
  await getDb().prepare('DELETE FROM design_comments WHERE id = ? OR parent_id = ?').run(cid, cid);
}

// ---------- Presencia ----------

export const PRESENCE_TTL_MS = 20_000;

export interface DesignPresence {
  userId: string;
  name: string;
  pageId: string;
}

/** Marca a la persona en el diseño y devuelve quién más está, más la versión guardada. */
export async function heartbeat(actor: DesignActor, id: string, pageId: string): Promise<{ people: DesignPresence[]; version: number; updatedBy: string | null }> {
  const { row } = await need(actor, id, 'view');
  const now = Date.now();
  await getDb()
    .prepare(
      `INSERT INTO design_presence (design_id, user_id, name, page_id, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(design_id, user_id) DO UPDATE SET name = excluded.name, page_id = excluded.page_id, updated_at = excluded.updated_at`,
    )
    .run(id, actor.personId, actor.name.slice(0, 120), String(pageId).slice(0, 64), new Date(now).toISOString());
  const people = (await getDb()
    .prepare('SELECT user_id AS userId, name, page_id AS pageId FROM design_presence WHERE design_id = ? AND user_id != ? AND updated_at > ? ORDER BY name')
    .all(id, actor.personId, new Date(now - PRESENCE_TTL_MS).toISOString())) as DesignPresence[];
  return { people, version: row.version, updatedBy: row.updated_by };
}

export async function leavePresence(actor: DesignActor, id: string): Promise<void> {
  await getDb().prepare('DELETE FROM design_presence WHERE design_id = ? AND user_id = ?').run(id, actor.personId);
}

// ---------- Archivos ----------

export interface DesignFileRow {
  id: string;
  workspace_id: string;
  uploaded_by: string;
  kind: string;
  url: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  name: string;
  created_at: string;
}

export interface DesignFileDto {
  id: string;
  width: number;
  height: number;
  name: string;
  kind: string;
}

const BLOB_URL = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/design\/[A-Za-z0-9._-]+$/;
const LOCAL_URL = /^\/uploads\/design\/[A-Za-z0-9._-]+$/;

export function isDesignUploadUrl(url: string): boolean {
  return BLOB_URL.test(url) || LOCAL_URL.test(url);
}

/**
 * Sube una imagen: el tipo sale de los bytes (PNG, JPEG, GIF o WebP; SVG no),
 * hasta 4 MB (DESIGN_MAX_UPLOAD_BYTES), y pasa por saveUpload (lista de tipos permitidos del storage).
 */
export async function saveDesignFile(actor: DesignActor, input: { bytes: Uint8Array; name: string; kind?: 'upload' | 'logo' }): Promise<DesignFileDto> {
  if (input.bytes.length > DESIGN_MAX_UPLOAD_BYTES) throw new DesignError('too_large', 413);
  const mime = sniffDesignImage(input.bytes);
  if (!mime) throw new DesignError('file_type_not_allowed', 415);
  const dims = imageDimensions(input.bytes, mime);
  if (!dims) throw new DesignError('file_type_not_allowed', 415);
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.slice(6);
  let url: string;
  try {
    url = await saveUpload('design', `image.${ext}`, mime, Buffer.from(input.bytes));
  } catch (err) {
    if (err instanceof UploadError) throw new DesignError(err.code === 'storage_unavailable' ? 'storage_unavailable' : 'file_type_not_allowed', err.status);
    throw err;
  }
  const id = newKey('f_');
  const name = (input.name || 'image').replace(/[\r\n\t]/g, ' ').slice(0, 120);
  await getDb()
    .prepare('INSERT INTO design_files (id, workspace_id, uploaded_by, kind, url, mime, size, width, height, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.ws, actor.personId, input.kind ?? 'upload', url, mime, input.bytes.length, dims.width, dims.height, name, nowIso());
  return { id, width: dims.width, height: dims.height, name, kind: input.kind ?? 'upload' };
}

export async function listMyFiles(actor: DesignActor, limit = 60): Promise<DesignFileDto[]> {
  return (await getDb()
    .prepare("SELECT id, width, height, name, kind FROM design_files WHERE workspace_id = ? AND uploaded_by = ? AND kind = 'upload' ORDER BY created_at DESC LIMIT ?")
    .all(actor.ws, actor.personId, limit)) as DesignFileDto[];
}

export async function getFileRow(id: string): Promise<DesignFileRow | null> {
  if (!FILE_ID_RE.test(id)) return null;
  return ((await getDb().prepare('SELECT * FROM design_files WHERE id = ?').get(id)) as DesignFileRow | undefined) ?? null;
}

async function writeFileRefs(designId: string, doc: DesignDoc): Promise<void> {
  const db = getDb();
  await db.prepare('DELETE FROM design_file_refs WHERE design_id = ?').run(designId);
  for (const fid of docFileIds(doc)) await db.prepare('INSERT OR IGNORE INTO design_file_refs (design_id, file_id) VALUES (?, ?)').run(designId, fid);
}

async function brandLogoIds(ws: string): Promise<string[]> {
  const r = (await getDb().prepare('SELECT logos FROM design_brand WHERE workspace_id = ?').get(ws)) as { logos: string } | undefined;
  try {
    const ids = r ? (JSON.parse(r.logos) as unknown) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * ¿La persona puede ver la imagen? Quien la subió; un logo del kit de marca,
 * todo el workspace; el resto, solo si ve un diseño (no borrado) que la usa.
 * Un admin no ve las imágenes de diseños privados de otros.
 */
export async function personCanReadFile(actor: Pick<DesignActor, 'ws' | 'personId'>, file: DesignFileRow): Promise<boolean> {
  if (file.workspace_id !== actor.ws) return false;
  if (file.uploaded_by === actor.personId) return true;
  if ((await brandLogoIds(actor.ws)).includes(file.id)) return true;
  const vis = visibleSql('d');
  const r = await getDb()
    .prepare(
      `SELECT 1 AS x FROM design_file_refs r JOIN design_designs d ON d.id = r.design_id
       WHERE r.file_id = ? AND d.workspace_id = ? AND d.deleted_at IS NULL AND ${vis.sql} LIMIT 1`,
    )
    .get(file.id, actor.ws, ...vis.argsFor(actor.personId));
  return Boolean(r);
}

/**
 * Al guardar, el diseño solo suma imágenes que la persona puede ver (las que
 * ya usaba se quedan aunque las haya subido otra persona).
 */
async function assertFilesReadable(actor: DesignActor, doc: DesignDoc, designId: string | null): Promise<void> {
  const ids = docFileIds(doc);
  if (!ids.length) return;
  const had = new Set(
    designId ? ((await getDb().prepare('SELECT file_id FROM design_file_refs WHERE design_id = ?').all(designId)) as Array<{ file_id: string }>).map((r) => r.file_id) : [],
  );
  for (const fid of ids) {
    if (had.has(fid)) continue;
    const file = await getFileRow(fid);
    if (!file || !(await personCanReadFile(actor, file))) throw new DesignError('forbidden', 403);
  }
}

/**
 * ¿Se sirve la imagen? A la persona según personCanReadFile, o a quien trae el
 * token vigente de un diseño que la usa. Revocar el link corta las imágenes.
 */
export async function canReadFile(file: DesignFileRow, viewer: { actor: Pick<DesignActor, 'ws' | 'personId'> | null; token: string | null }): Promise<boolean> {
  if (viewer.actor && (await personCanReadFile(viewer.actor, file))) return true;
  if (!viewer.token) return false;
  const pub = await getPublicDesign(viewer.token);
  if (!pub || pub.row.workspace_id !== file.workspace_id) return false;
  return docFileIds(pub.doc).includes(file.id);
}

export async function readDesignFile(file: DesignFileRow): Promise<Uint8Array | null> {
  if (!isDesignUploadUrl(file.url)) return null;
  if (file.url.startsWith('/uploads/')) {
    const path = localUploadPath(file.url, 'design');
    if (!path) return null;
    try {
      return new Uint8Array(await readFile(path));
    } catch {
      return null;
    }
  }
  // Solo URLs del Blob de Design (nada de SSRF).
  const res = await fetch(file.url).catch(() => null);
  if (!res?.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

// ---------- Kit de marca ----------

export interface BrandKit {
  colors: string[];
  fonts: { heading: FontKey | null; subheading: FontKey | null; body: FontKey | null };
  logos: DesignFileDto[];
  updatedAt: string | null;
}

const isFont = (v: unknown): v is FontKey => typeof v === 'string' && (FONT_KEYS as readonly string[]).includes(v);

export async function getBrandKit(ws: string): Promise<BrandKit> {
  const row = (await getDb().prepare('SELECT * FROM design_brand WHERE workspace_id = ?').get(ws)) as
    | { colors: string; fonts: string; logos: string; updated_at: string }
    | undefined;
  const parse = <T>(s: string | undefined, d: T): T => {
    try {
      return s ? (JSON.parse(s) as T) : d;
    } catch {
      return d;
    }
  };
  const colors = parse<unknown[]>(row?.colors, []).filter(isColor);
  const f = parse<Record<string, unknown>>(row?.fonts, {});
  const logoIds = parse<unknown[]>(row?.logos, []).filter((x): x is string => typeof x === 'string' && FILE_ID_RE.test(x));
  const logos: DesignFileDto[] = [];
  for (const id of logoIds) {
    const r = (await getDb().prepare('SELECT id, width, height, name, kind FROM design_files WHERE id = ? AND workspace_id = ?').get(id, ws)) as DesignFileDto | undefined;
    if (r) logos.push(r);
  }
  return {
    colors,
    fonts: { heading: isFont(f.heading) ? f.heading : null, subheading: isFont(f.subheading) ? f.subheading : null, body: isFont(f.body) ? f.body : null },
    logos,
    updatedAt: row?.updated_at ?? null,
  };
}

/** Solo owner y admins editan el kit; todo el workspace lo usa. */
export async function saveBrandKit(actor: DesignActor, input: { colors: string[]; fonts: Partial<Record<'heading' | 'subheading' | 'body', string | null>>; logos: string[] }): Promise<BrandKit> {
  if (!actor.admin) throw new DesignError('forbidden', 403);
  const colors = [...new Set(input.colors.filter(isColor).map((c) => c.toLowerCase()))].slice(0, 24);
  const fonts = {
    heading: isFont(input.fonts.heading) ? input.fonts.heading : null,
    subheading: isFont(input.fonts.subheading) ? input.fonts.subheading : null,
    body: isFont(input.fonts.body) ? input.fonts.body : null,
  };
  const logos: string[] = [];
  for (const id of input.logos.slice(0, 12)) {
    if (!FILE_ID_RE.test(id)) continue;
    const file = await getFileRow(id);
    if (file && (await personCanReadFile(actor, file))) logos.push(id);
  }
  await getDb()
    .prepare(
      `INSERT INTO design_brand (workspace_id, colors, fonts, logos, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET colors = excluded.colors, fonts = excluded.fonts, logos = excluded.logos, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(actor.ws, JSON.stringify(colors), JSON.stringify(fonts), JSON.stringify([...new Set(logos)]), actor.personId, nowIso());
  return getBrandKit(actor.ws);
}

// ---------- Inicio ----------

/** Lo último abierto o editado (para "Recientes" del inicio de la plataforma). */
export async function recentDesigns(actor: DesignActor, limit = 8): Promise<Array<{ id: string; name: string; updated_at: string }>> {
  const list = await listDesigns(actor, { view: 'recent', limit });
  return list.map((d) => ({ id: d.id, name: d.name, updated_at: d.updatedAt }));
}
