import { getDb, type DocsCommentRow, type DocsPageRow, type DocsShareRow, type TeamRow, type UserRow } from './db';
import { sanitizeBlocks } from './docs-sanitize';
import { isMember } from './teams';
import {
  type DocsAccess,
  type DocsBlock,
  type DocsBlockType,
  type DocsComment,
  type DocsPage,
  type DocsPageShare,
  type DocsShareRole,
  defaultBlocks,
  stringifyBlocks,
} from './docs-types';

export type { DocsBlock, DocsBlockType, DocsComment, DocsPage, DocsPageShare };
export { defaultBlocks, stringifyBlocks } from './docs-types';

// ---------- Helpers JSON ----------

export function parseBlocks(raw: string | null | undefined): DocsBlock[] {
  if (!raw || raw === 'null') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as DocsBlock[];
    return [];
  } catch {
    return [];
  }
}

export function toDocPage(row: DocsPageRow): DocsPage {
  return {
    id: row.id,
    user_id: row.user_id,
    parent_id: row.parent_id,
    title: row.title,
    icon: row.icon,
    cover_url: row.cover_url,
    content: parseBlocks(row.content),
    is_public: row.is_public === 1,
    published: row.published === 1,
    slug: row.slug ?? null,
    archived: row.archived === 1,
    small_text: row.small_text === 1,
    full_width: row.full_width === 1,
    position: row.position ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toShare(row: DocsShareRow): DocsPageShare {
  return { ...row, role: row.role === 'edit' ? 'edit' : 'view' };
}

/** "Cómo empezar ¿rápido?" → "como-empezar-rapido". */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/** Slug libre dentro del workspace (base, base-2, base-3…). */
async function uniqueSlug(ownerId: string, pageId: string, title: string): Promise<string> {
  const base = slugifyTitle(title) || `page-${pageId.slice(0, 8)}`;
  const taken = new Set(
    ((await getDb()
      .prepare('SELECT slug FROM docs_pages WHERE user_id = ? AND slug IS NOT NULL AND id != ?')
      .all(ownerId, pageId)) as Array<{ slug: string }>).map((r) => r.slug),
  );
  let candidate = base;
  for (let i = 2; taken.has(candidate); i++) candidate = `${base}-${i}`;
  return candidate;
}

// ---------- Permisos ----------

export interface DocsActor {
  id: string; // owner workspace id (datos viven bajo este id)
  actingUser?: UserRow; // usuario real cuando actúa en un team ajeno
  team?: TeamRow | null;
}

/**
 * Acceso efectivo del actor a una página (null = sin acceso).
 * - Owner del workspace: 'owner'.
 * - Shares: por usuario real (target_id = id de la persona) o por team del
 *   que es miembro; gana el rol más alto ('edit' > 'view').
 * - Publicada en el centro de ayuda: cualquiera autenticado puede leerla.
 * `is_public` ya NO da lectura: solo habilita a la IA del Chat.
 *
 * `includePublished: false` ignora la publicación: el centro de ayuda solo
 * expone el contenido actual, no el historial, los comentarios ni las
 * menciones (eso exige ser owner o tener un share explícito).
 * `includePublicLink: false` ignora además el share "cualquiera con el link"
 * (para escrituras como comentar o resolver hilos).
 */
export interface DocAccessOptions {
  includePublished?: boolean;
  includePublicLink?: boolean;
}

/** Historial y comentarios: owner o share explícito (no alcanza con publicada). */
export const DOC_INTERNAL_READ: DocAccessOptions = { includePublished: false };
/** Comentar, resolver y mencionar: share de persona/team (ni publicada ni link público). */
export const DOC_INTERNAL_WRITE: DocAccessOptions = { includePublished: false, includePublicLink: false };

export async function getDocAccess(
  page: DocsPageRow,
  actor: DocsActor,
  opts: DocAccessOptions = {},
): Promise<DocsAccess | null> {
  const includePublished = opts.includePublished ?? true;
  const includePublicLink = opts.includePublicLink ?? true;
  if (page.user_id === actor.id) return 'owner';
  const userId = actor.actingUser?.id ?? actor.id;
  const shares = (await getDb()
    .prepare('SELECT * FROM docs_shares WHERE page_id = ?')
    .all(page.id)) as DocsShareRow[];
  let access: DocsAccess | null = null;
  for (const share of shares) {
    let match = false;
    if (share.kind === 'public') match = includePublicLink;
    else if (share.kind === 'user' && share.target_id === userId) match = true;
    else if (share.kind === 'team' && share.target_id) match = await isMember(share.target_id, userId);
    if (!match) continue;
    if (share.role === 'edit' && share.kind !== 'public') return 'edit';
    access = 'view';
  }
  if (!access && includePublished && page.published === 1 && page.archived === 0) access = 'view';
  return access;
}

/** Fila + acceso del actor, o null si la página no existe o no la puede ver. */
export async function resolveDocAccess(
  actor: DocsActor,
  pageId: string,
  opts: DocAccessOptions = {},
): Promise<{ row: DocsPageRow; access: DocsAccess } | null> {
  const row = (await getDb().prepare('SELECT * FROM docs_pages WHERE id = ?').get(pageId)) as
    | DocsPageRow
    | undefined;
  if (!row) return null;
  const access = await getDocAccess(row, actor, opts);
  return access ? { row, access } : null;
}

/** Verifica si el actor puede leer una página (ver getDocAccess). */
export async function canReadPage(
  page: DocsPageRow,
  actor: DocsActor,
  opts: DocAccessOptions = {},
): Promise<boolean> {
  return (await getDocAccess(page, actor, opts)) !== null;
}

export async function canEditPage(page: DocsPageRow, actor: DocsActor): Promise<boolean> {
  const access = await getDocAccess(page, actor);
  return access === 'owner' || access === 'edit';
}

// ---------- CRUD ----------

export async function listDocPages(
  ownerId: string,
  opts: { archived?: boolean } = {},
): Promise<DocsPage[]> {
  const archived = opts.archived ? 1 : 0;
  const rows = (await getDb()
    .prepare(
      // Orden manual primero (position), el resto como antes (más recientes arriba).
      'SELECT * FROM docs_pages WHERE user_id = ? AND archived = ? ORDER BY (position IS NULL) ASC, position ASC, updated_at DESC',
    )
    .all(ownerId, archived)) as DocsPageRow[];
  return rows.map(toDocPage);
}

export async function getDocPage(
  ownerId: string,
  pageId: string,
): Promise<DocsPage | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ?')
    .get(pageId)) as DocsPageRow | undefined;
  if (!row) return null;
  if (row.user_id !== ownerId) return null;
  return toDocPage(row);
}

export interface CreateDocPageInput {
  title?: string;
  parent_id?: string | null;
  icon?: string | null;
  cover_url?: string | null;
  content?: DocsBlock[];
}

export async function createDocPage(
  ownerId: string,
  input: CreateDocPageInput,
): Promise<DocsPage> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = (input.title ?? '').trim();
  let parentId = input.parent_id ?? null;
  if (parentId) {
    // Solo se cuelga de páginas del mismo workspace.
    const parent = (await getDb()
      .prepare('SELECT user_id FROM docs_pages WHERE id = ?')
      .get(parentId)) as { user_id: string } | undefined;
    if (!parent || parent.user_id !== ownerId) parentId = null;
  }
  const icon = input.icon ?? null;
  const coverUrl = input.cover_url ?? null;
  const content = stringifyBlocks(sanitizeBlocks(input.content ?? defaultBlocks()));

  await getDb()
    .prepare(
      `INSERT INTO docs_pages (id, user_id, parent_id, title, icon, cover_url, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, ownerId, parentId, title, icon, coverUrl, content, now, now);

  const row = (await getDb().prepare('SELECT * FROM docs_pages WHERE id = ?').get(id)) as DocsPageRow;
  return toDocPage(row);
}

export interface UpdateDocPageInput {
  title?: string;
  icon?: string | null;
  cover_url?: string | null;
  content?: DocsBlock[];
  parent_id?: string | null;
  is_public?: boolean;
  published?: boolean;
  archived?: boolean;
  small_text?: boolean;
  full_width?: boolean;
}

export async function updateDocPage(
  ownerId: string,
  pageId: string,
  input: UpdateDocPageInput,
): Promise<DocsPage | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ?')
    .get(pageId)) as DocsPageRow | undefined;
  if (!row || row.user_id !== ownerId) return null;

  // Re-parentar: el nuevo padre tiene que ser del mismo workspace y no puede
  // ser la propia página ni una de sus descendientes (armaría un ciclo y el
  // subárbol desaparecería del árbol y del centro de ayuda).
  if (input.parent_id != null && input.parent_id !== row.parent_id) {
    if (input.parent_id === pageId) return null;
    const parent = (await getDb()
      .prepare('SELECT user_id FROM docs_pages WHERE id = ?')
      .get(input.parent_id)) as { user_id: string } | undefined;
    if (!parent || parent.user_id !== ownerId) return null;
    if ((await collectDescendants(ownerId, pageId)).includes(input.parent_id)) return null;
  }

  const updates: string[] = [];
  const args: (string | number | null)[] = [];

  if (input.title !== undefined) {
    updates.push('title = ?');
    args.push(input.title.trim());
  }
  if (input.icon !== undefined) {
    updates.push('icon = ?');
    args.push(input.icon);
  }
  if (input.cover_url !== undefined) {
    updates.push('cover_url = ?');
    args.push(input.cover_url);
  }
  if (input.content !== undefined) {
    updates.push('content = ?');
    args.push(stringifyBlocks(sanitizeBlocks(input.content)));
  }
  if (input.parent_id !== undefined) {
    updates.push('parent_id = ?');
    args.push(input.parent_id);
    // Cambiar de padre descarta el orden manual del grupo anterior.
    if (input.parent_id !== row.parent_id) updates.push('position = NULL');
  }
  if (input.small_text !== undefined) {
    updates.push('small_text = ?');
    args.push(input.small_text ? 1 : 0);
  }
  if (input.full_width !== undefined) {
    updates.push('full_width = ?');
    args.push(input.full_width ? 1 : 0);
  }
  if (input.is_public !== undefined) {
    updates.push('is_public = ?');
    args.push(input.is_public ? 1 : 0);
  }
  if (input.published !== undefined) {
    updates.push('published = ?');
    args.push(input.published ? 1 : 0);
    if (input.published && row.published !== 1) {
      // El slug se fija al publicar por primera vez y queda estable (los
      // links del centro de ayuda no se rompen al renombrar la página).
      if (!row.slug) {
        updates.push('slug = ?');
        args.push(await uniqueSlug(ownerId, pageId, input.title ?? row.title));
      }
      updates.push('published_at = ?');
      args.push(new Date().toISOString());
    }
  }
  if (input.archived !== undefined) {
    updates.push('archived = ?');
    args.push(input.archived ? 1 : 0);
  }

  if (updates.length === 0) return toDocPage(row);

  updates.push('updated_at = ?');
  args.push(new Date().toISOString());
  args.push(pageId);

  await getDb()
    .prepare(`UPDATE docs_pages SET ${updates.join(', ')} WHERE id = ?`)
    .run(...args);

  // Papelera: archivar/restaurar arrastra a las subpáginas (si no, quedaban
  // huérfanas en la raíz del árbol al mandar el padre a la papelera).
  if (input.archived !== undefined && (row.archived === 1) !== input.archived) {
    const ids = (await collectDescendants(ownerId, pageId)).filter((x) => x !== pageId);
    if (ids.length > 0) {
      await getDb()
        .prepare(`UPDATE docs_pages SET archived = ? WHERE id IN (${ids.map(() => '?').join(',')})`)
        .run(input.archived ? 1 : 0, ...ids);
    }
  }

  const updated = (await getDb().prepare('SELECT * FROM docs_pages WHERE id = ?').get(pageId)) as DocsPageRow;
  return toDocPage(updated);
}

/** Recupera la cadena de ancestros de una página (más cercano primero). */
export async function getDocPageAncestors(
  ownerId: string,
  pageId: string,
): Promise<DocsPage[]> {
  const ancestors: DocsPage[] = [];
  let currentId: string | null = pageId;
  const seen = new Set<string>();
  while (currentId) {
    const row = (await getDb()
      .prepare('SELECT * FROM docs_pages WHERE id = ? AND user_id = ?')
      .get(currentId, ownerId)) as DocsPageRow | undefined;
    if (!row || seen.has(row.id)) break;
    seen.add(row.id);
    ancestors.unshift(toDocPage(row));
    currentId = row.parent_id;
  }
  return ancestors;
}

/** Duplica una página y todos sus descendientes. */
export async function duplicateDocPage(
  ownerId: string,
  pageId: string,
): Promise<DocsPage | null> {
  const source = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ? AND user_id = ?')
    .get(pageId, ownerId)) as DocsPageRow | undefined;
  if (!source) return null;

  const idMap = new Map<string, string>();

  async function clone(currentId: string, newParentId: string | null): Promise<void> {
    const row = (await getDb()
      .prepare('SELECT * FROM docs_pages WHERE id = ? AND user_id = ?')
      .get(currentId, ownerId)) as DocsPageRow | undefined;
    if (!row) return;

    const newId = crypto.randomUUID();
    idMap.set(currentId, newId);
    const now = new Date().toISOString();
    await getDb()
      .prepare(
        `INSERT INTO docs_pages
         (id, user_id, parent_id, title, icon, cover_url, content, is_public, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId,
        ownerId,
        newParentId,
        `${row.title || 'Untitled'} (Copy)`,
        row.icon,
        row.cover_url,
        row.content,
        0,
        0,
        now,
        now,
      );

    const children = (await getDb()
      .prepare('SELECT id FROM docs_pages WHERE parent_id = ? AND user_id = ?')
      .all(currentId, ownerId)) as Array<{ id: string }>;
    for (const child of children) {
      await clone(child.id, newId);
    }
  }

  await clone(pageId, source.parent_id);
  const newRootId = idMap.get(pageId);
  if (!newRootId) return null;
  return getDocPage(ownerId, newRootId);
}

/** Lista IDs descendientes de un árbol de páginas (incluye la raíz). */
export async function collectDescendants(ownerId: string, rootId: string): Promise<string[]> {
  const ids: string[] = [rootId];
  const queue: string[] = [rootId];
  // Defensa ante datos con ciclos de parent_id (no recorrer para siempre).
  const seen = new Set<string>([rootId]);
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const rows = (await getDb()
      .prepare('SELECT id FROM docs_pages WHERE user_id = ? AND parent_id = ?')
      .all(ownerId, parentId)) as Array<{ id: string }>;
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      ids.push(row.id);
      queue.push(row.id);
    }
  }
  return ids;
}

export async function deleteDocPage(ownerId: string, pageId: string): Promise<boolean> {
  const row = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ?')
    .get(pageId)) as DocsPageRow | undefined;
  if (!row || row.user_id !== ownerId) return false;

  const ids = await collectDescendants(ownerId, pageId);
  const placeholders = ids.map(() => '?').join(',');
  await getDb()
    .prepare(`DELETE FROM docs_pages WHERE id IN (${placeholders})`)
    .run(...ids);
  return true;
}

export async function moveDocPage(
  ownerId: string,
  pageId: string,
  parentId: string | null,
): Promise<DocsPage | null> {
  return updateDocPage(ownerId, pageId, { parent_id: parentId });
}

export type DocDropPlacement = 'before' | 'after';

/**
 * Reordena una página entre sus hermanos: la ubica antes/después de `targetId`
 * (y pasa a ser hermana de target si tenía otro padre). Reescribe `position`
 * de todo el grupo. No toca updated_at (no es una edición de contenido).
 */
export async function reorderDocPage(
  ownerId: string,
  pageId: string,
  targetId: string,
  placement: DocDropPlacement,
): Promise<boolean> {
  if (pageId === targetId) return false;
  const db = getDb();
  const page = (await db.prepare('SELECT * FROM docs_pages WHERE id = ?').get(pageId)) as DocsPageRow | undefined;
  const target = (await db.prepare('SELECT * FROM docs_pages WHERE id = ?').get(targetId)) as DocsPageRow | undefined;
  if (!page || !target || page.user_id !== ownerId || target.user_id !== ownerId) return false;
  // No se puede colgar una página dentro de su propio subárbol.
  const descendants = await collectDescendants(ownerId, pageId);
  if (descendants.includes(targetId)) return false;

  const parentId = target.parent_id;
  const siblings = (await db
    .prepare(
      `SELECT id FROM docs_pages
       WHERE user_id = ? AND archived = ? AND ${parentId ? 'parent_id = ?' : 'parent_id IS NULL'} AND id != ?
       ORDER BY (position IS NULL) ASC, position ASC, updated_at DESC`,
    )
    .all(...[ownerId, target.archived, ...(parentId ? [parentId] : []), pageId])) as Array<{ id: string }>;
  const order = siblings.map((r) => r.id);
  const at = order.indexOf(targetId);
  order.splice(placement === 'before' ? at : at + 1, 0, pageId);

  if (page.parent_id !== parentId) {
    await db.prepare('UPDATE docs_pages SET parent_id = ? WHERE id = ? AND user_id = ?').run(parentId, pageId, ownerId);
  }
  for (const [i, id] of order.entries()) {
    await db.prepare('UPDATE docs_pages SET position = ? WHERE id = ? AND user_id = ?').run(i, id, ownerId);
  }
  return true;
}

/** "Move up / Move down": intercambia la página con su hermana anterior/siguiente. */
export async function moveDocPageStep(ownerId: string, pageId: string, dir: -1 | 1): Promise<boolean> {
  const db = getDb();
  const page = (await db.prepare('SELECT * FROM docs_pages WHERE id = ?').get(pageId)) as DocsPageRow | undefined;
  if (!page || page.user_id !== ownerId) return false;
  const siblings = (await db
    .prepare(
      `SELECT id FROM docs_pages
       WHERE user_id = ? AND archived = ? AND ${page.parent_id ? 'parent_id = ?' : 'parent_id IS NULL'}
       ORDER BY (position IS NULL) ASC, position ASC, updated_at DESC`,
    )
    .all(...[ownerId, page.archived, ...(page.parent_id ? [page.parent_id] : [])])) as Array<{ id: string }>;
  const idx = siblings.findIndex((r) => r.id === pageId);
  const neighbor = siblings[idx + dir];
  if (idx === -1 || !neighbor) return false;
  return reorderDocPage(ownerId, pageId, neighbor.id, dir === -1 ? 'before' : 'after');
}

// ---------- Shares ----------

export async function listDocShares(pageId: string): Promise<DocsPageShare[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM docs_shares WHERE page_id = ? ORDER BY created_at DESC')
    .all(pageId)) as DocsShareRow[];
  return rows.map(toShare);
}

export async function createDocShare(
  ownerId: string,
  pageId: string,
  kind: 'public' | 'team' | 'user',
  targetId?: string | null,
  role: DocsShareRole = 'view',
): Promise<DocsPageShare | null> {
  const page = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ?')
    .get(pageId)) as DocsPageRow | undefined;
  if (!page || page.user_id !== ownerId) return null;
  const effectiveRole: DocsShareRole = kind === 'public' ? 'view' : role;

  // Compartir de nuevo con el mismo destino actualiza el rol (sin duplicar).
  const existing = (await getDb()
    .prepare('SELECT * FROM docs_shares WHERE page_id = ? AND kind = ? AND target_id IS ?')
    .get(pageId, kind, targetId ?? null)) as DocsShareRow | undefined;
  if (existing) {
    await getDb().prepare('UPDATE docs_shares SET role = ? WHERE id = ?').run(effectiveRole, existing.id);
    return toShare({ ...existing, role: effectiveRole });
  }

  const id = crypto.randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO docs_shares (id, page_id, kind, target_id, role) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, pageId, kind, targetId ?? null, effectiveRole);

  const row = (await getDb().prepare('SELECT * FROM docs_shares WHERE id = ?').get(id)) as DocsShareRow;
  return toShare(row);
}

export async function updateDocShareRole(
  ownerId: string,
  pageId: string,
  shareId: string,
  role: DocsShareRole,
): Promise<DocsPageShare | null> {
  const page = await getDocPageRow(pageId);
  if (!page || page.user_id !== ownerId) return null;
  const share = (await getDb()
    .prepare('SELECT * FROM docs_shares WHERE id = ? AND page_id = ?')
    .get(shareId, pageId)) as DocsShareRow | undefined;
  if (!share || share.kind === 'public') return null;
  await getDb().prepare('UPDATE docs_shares SET role = ? WHERE id = ?').run(role, shareId);
  return toShare({ ...share, role });
}

export interface SharedDocPage {
  id: string;
  title: string;
  icon: string | null;
  role: DocsShareRole;
  owner_name: string | null;
  owner_email: string;
  updated_at: string;
}

/**
 * Páginas de OTROS workspaces compartidas con la persona (directo o vía un
 * team del que es miembro). Las del workspace activo no se repiten.
 */
export async function listSharedWithMe(realUserId: string, workspaceId: string): Promise<SharedDocPage[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT p.id, p.title, p.icon, p.updated_at, s.role, u.name AS owner_name, u.email AS owner_email
       FROM docs_shares s
       JOIN docs_pages p ON p.id = s.page_id
       JOIN users u ON u.id = p.user_id
       WHERE p.archived = 0 AND p.user_id != ?
         AND ((s.kind = 'user' AND s.target_id = ?)
           OR (s.kind = 'team' AND s.target_id IN (
                 SELECT team_id FROM team_members WHERE user_id = ?
                 UNION SELECT id FROM teams WHERE owner_id = ?)))
       ORDER BY p.updated_at DESC
       LIMIT 200`,
    )
    .all(workspaceId, realUserId, realUserId, realUserId)) as Array<SharedDocPage & { role: string }>;
  const byId = new Map<string, SharedDocPage>();
  for (const r of rows) {
    const role: DocsShareRole = r.role === 'edit' ? 'edit' : 'view';
    const prev = byId.get(r.id);
    if (!prev || (prev.role === 'view' && role === 'edit')) byId.set(r.id, { ...r, role });
  }
  return [...byId.values()];
}

export async function deleteDocShare(
  ownerId: string,
  pageId: string,
  shareId: string,
): Promise<boolean> {
  const page = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ?')
    .get(pageId)) as DocsPageRow | undefined;
  if (!page || page.user_id !== ownerId) return false;

  const res = await getDb()
    .prepare('DELETE FROM docs_shares WHERE id = ? AND page_id = ?')
    .run(shareId, pageId);
  return res.changes > 0;
}

// ---------- Comments ----------

type DocsCommentJoinedRow = DocsCommentRow & {
  user_name: string | null;
  user_email: string;
  user_image: string | null;
};

function toComment(row: DocsCommentJoinedRow): DocsComment {
  return {
    id: row.id,
    page_id: row.page_id,
    user_id: row.user_id,
    block_id: row.block_id,
    body: row.body,
    resolved: row.resolved === 1,
    created_at: row.created_at,
    user_name: row.user_name,
    user_email: row.user_email,
    user_image: row.user_image,
  };
}

/** Fila cruda de una página (sin chequeo de owner) para permisos canRead/canEdit. */
export async function getDocPageRow(pageId: string): Promise<DocsPageRow | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ?')
    .get(pageId)) as DocsPageRow | undefined;
  return row ?? null;
}

export async function getDocComment(commentId: string): Promise<DocsComment | null> {
  const row = (await getDb()
    .prepare(
      `SELECT c.*, u.name AS user_name, u.email AS user_email, u.image AS user_image
       FROM docs_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = ?`,
    )
    .get(commentId)) as DocsCommentJoinedRow | undefined;
  return row ? toComment(row) : null;
}

export async function listDocComments(pageId: string): Promise<DocsComment[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT c.*, u.name AS user_name, u.email AS user_email, u.image AS user_image
       FROM docs_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.page_id = ?
       ORDER BY c.resolved ASC, c.created_at ASC`,
    )
    .all(pageId)) as DocsCommentJoinedRow[];
  return rows.map(toComment);
}

export async function createDocComment(
  pageId: string,
  userId: string,
  input: { body: string; block_id?: string | null },
): Promise<DocsComment> {
  const id = crypto.randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO docs_comments (id, page_id, user_id, block_id, body, resolved, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(id, pageId, userId, input.block_id ?? null, input.body.trim(), new Date().toISOString());
  return (await getDocComment(id))!;
}

export async function setDocCommentResolved(
  commentId: string,
  resolved: boolean,
): Promise<DocsComment | null> {
  await getDb()
    .prepare('UPDATE docs_comments SET resolved = ? WHERE id = ?')
    .run(resolved ? 1 : 0, commentId);
  return getDocComment(commentId);
}

export async function deleteDocComment(commentId: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM docs_comments WHERE id = ?').run(commentId);
  return res.changes > 0;
}

// ---------- Search / mentions ----------

export async function searchDocPages(
  ownerId: string,
  query: string,
): Promise<DocsPage[]> {
  const q = `%${query.trim().replace(/[%_]/g, '\\$&')}%`;
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM docs_pages
       WHERE user_id = ? AND archived = 0 AND title LIKE ? ESCAPE '\\'
       ORDER BY updated_at DESC
       LIMIT 20`,
    )
    .all(ownerId, q)) as DocsPageRow[];
  return rows.map(toDocPage);
}

// ---------- Re-export tree helpers (pure, live in docs-types) ----------

export { buildPageTree, flattenPageTree } from './docs-types';
