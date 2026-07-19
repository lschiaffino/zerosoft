import { getDb, type DocsPageRow, type DocsShareRow, type TeamRow, type UserRow } from './db';
import { isMember } from './teams';
import {
  type DocsBlock,
  type DocsBlockType,
  type DocsPage,
  type DocsPageShare,
  defaultBlocks,
  stringifyBlocks,
} from './docs-types';

export type { DocsBlock, DocsBlockType, DocsPage, DocsPageShare };
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

function toPage(row: DocsPageRow): DocsPage {
  return {
    id: row.id,
    user_id: row.user_id,
    parent_id: row.parent_id,
    title: row.title,
    icon: row.icon,
    cover_url: row.cover_url,
    content: parseBlocks(row.content),
    is_public: row.is_public === 1,
    archived: row.archived === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toShare(row: DocsShareRow): DocsPageShare {
  return { ...row };
}

// ---------- Permisos ----------

export interface DocsActor {
  id: string; // owner workspace id (datos viven bajo este id)
  actingUser?: UserRow; // usuario real cuando actúa en un team ajeno
  team?: TeamRow | null;
}

/**
 * Verifica si el actor puede leer una página.
 * - Owner: siempre.
 * - Pública: cualquiera autenticado (incluye invitados de team).
 * - Team: miembros del team objetivo del share.
 * - Usuario: el usuario real coincide con target_id.
 */
export async function canReadPage(
  page: DocsPageRow,
  actor: DocsActor,
): Promise<boolean> {
  if (page.user_id === actor.id) return true;
  if (page.is_public === 1) return true;

  const shares = (await getDb()
    .prepare('SELECT * FROM docs_shares WHERE page_id = ?')
    .all(page.id)) as DocsShareRow[];

  for (const share of shares) {
    if (share.kind === 'public') return true;
    if (share.kind === 'team' && share.target_id) {
      const userId = actor.actingUser?.id ?? actor.id;
      if (await isMember(share.target_id, userId)) return true;
    }
    if (share.kind === 'user' && share.target_id) {
      const userId = actor.actingUser?.id ?? actor.id;
      if (share.target_id === userId) return true;
    }
  }
  return false;
}

export async function canEditPage(
  page: DocsPageRow,
  actor: DocsActor,
): Promise<boolean> {
  if (page.user_id === actor.id) return true;
  const userId = actor.actingUser?.id ?? actor.id;
  if (actor.team && actor.team.owner_id === userId) return true;
  return false;
}

// ---------- CRUD ----------

export async function listDocPages(
  ownerId: string,
  opts: { archived?: boolean } = {},
): Promise<DocsPage[]> {
  const archived = opts.archived ? 1 : 0;
  const rows = (await getDb()
    .prepare(
      'SELECT * FROM docs_pages WHERE user_id = ? AND archived = ? ORDER BY updated_at DESC',
    )
    .all(ownerId, archived)) as DocsPageRow[];
  return rows.map(toPage);
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
  return toPage(row);
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
  const parentId = input.parent_id ?? null;
  const icon = input.icon ?? null;
  const coverUrl = input.cover_url ?? null;
  const content = stringifyBlocks(input.content ?? defaultBlocks());

  await getDb()
    .prepare(
      `INSERT INTO docs_pages (id, user_id, parent_id, title, icon, cover_url, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, ownerId, parentId, title, icon, coverUrl, content, now, now);

  const row = (await getDb().prepare('SELECT * FROM docs_pages WHERE id = ?').get(id)) as DocsPageRow;
  return toPage(row);
}

export interface UpdateDocPageInput {
  title?: string;
  icon?: string | null;
  cover_url?: string | null;
  content?: DocsBlock[];
  parent_id?: string | null;
  is_public?: boolean;
  archived?: boolean;
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
    args.push(stringifyBlocks(input.content));
  }
  if (input.parent_id !== undefined) {
    updates.push('parent_id = ?');
    args.push(input.parent_id);
  }
  if (input.is_public !== undefined) {
    updates.push('is_public = ?');
    args.push(input.is_public ? 1 : 0);
  }
  if (input.archived !== undefined) {
    updates.push('archived = ?');
    args.push(input.archived ? 1 : 0);
  }

  if (updates.length === 0) return toPage(row);

  updates.push('updated_at = ?');
  args.push(new Date().toISOString());
  args.push(pageId);

  await getDb()
    .prepare(`UPDATE docs_pages SET ${updates.join(', ')} WHERE id = ?`)
    .run(...args);

  const updated = (await getDb().prepare('SELECT * FROM docs_pages WHERE id = ?').get(pageId)) as DocsPageRow;
  return toPage(updated);
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
    ancestors.unshift(toPage(row));
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
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const rows = (await getDb()
      .prepare('SELECT id FROM docs_pages WHERE user_id = ? AND parent_id = ?')
      .all(ownerId, parentId)) as Array<{ id: string }>;
    for (const row of rows) {
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
): Promise<DocsPageShare | null> {
  const page = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ?')
    .get(pageId)) as DocsPageRow | undefined;
  if (!page || page.user_id !== ownerId) return null;

  const id = crypto.randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO docs_shares (id, page_id, kind, target_id) VALUES (?, ?, ?, ?)`,
    )
    .run(id, pageId, kind, targetId ?? null);

  const row = (await getDb().prepare('SELECT * FROM docs_shares WHERE id = ?').get(id)) as DocsShareRow;
  return toShare(row);
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
  return rows.map(toPage);
}

// ---------- Re-export tree helpers (pure, live in docs-types) ----------

export { buildPageTree, flattenPageTree } from './docs-types';
