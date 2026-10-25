import { getDb } from './db';
import type { DocsPageSummary } from './docs-types';

/**
 * Favoritos de Docs: por persona (no por workspace) y con orden manual, como
 * la sección Favoritos del sidebar de Notion. Solo páginas del workspace
 * activo que no estén en la papelera.
 */

export type DocsFavorite = Pick<DocsPageSummary, 'id' | 'title' | 'icon'>;

export const DOCS_FAVORITES_MAX = 200;

export async function listDocFavorites(userId: string, workspaceId: string): Promise<DocsFavorite[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT p.id, p.title, p.icon FROM docs_favorites f
       JOIN docs_pages p ON p.id = f.page_id
       WHERE f.user_id = ? AND f.workspace_id = ? AND p.user_id = f.workspace_id AND p.archived = 0
       ORDER BY f.position ASC, f.created_at ASC`,
    )
    .all(userId, workspaceId)) as DocsFavorite[];
  return rows.map((r) => ({ id: r.id, title: r.title, icon: r.icon ?? null }));
}

export async function isDocFavorite(userId: string, pageId: string): Promise<boolean> {
  const row = await getDb().prepare('SELECT 1 AS x FROM docs_favorites WHERE user_id = ? AND page_id = ?').get(userId, pageId);
  return Boolean(row);
}

export class DocsFavoriteLimitError extends Error {
  constructor() {
    super('favorite_limit');
  }
}

/** Agrega al final (idempotente). */
export async function addDocFavorite(userId: string, workspaceId: string, pageId: string): Promise<void> {
  const db = getDb();
  const count = (await db
    .prepare('SELECT COUNT(*) AS n, MAX(position) AS maxpos FROM docs_favorites WHERE user_id = ? AND workspace_id = ?')
    .get(userId, workspaceId)) as { n: number; maxpos: number | null };
  if (Number(count.n) >= DOCS_FAVORITES_MAX) throw new DocsFavoriteLimitError();
  await db
    .prepare(
      `INSERT INTO docs_favorites (user_id, workspace_id, page_id, position, created_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, page_id) DO NOTHING`,
    )
    .run(userId, workspaceId, pageId, Number(count.maxpos ?? 0) + 1, new Date().toISOString());
}

export async function removeDocFavorite(userId: string, pageId: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM docs_favorites WHERE user_id = ? AND page_id = ?').run(userId, pageId);
  return res.changes > 0;
}

/** Orden nuevo: los ids en el orden pedido (los que no son favoritos se ignoran). */
export async function reorderDocFavorites(userId: string, workspaceId: string, ids: string[]): Promise<void> {
  const db = getDb();
  let pos = 1;
  for (const id of [...new Set(ids)].slice(0, DOCS_FAVORITES_MAX)) {
    await db
      .prepare('UPDATE docs_favorites SET position = ? WHERE user_id = ? AND workspace_id = ? AND page_id = ?')
      .run(pos++, userId, workspaceId, id);
  }
}

/** Posición nueva de un favorito al soltarlo antes/después de otro (pura). */
export function moveInOrder(ids: string[], id: string, targetId: string, placement: 'before' | 'after'): string[] {
  if (id === targetId || !ids.includes(id) || !ids.includes(targetId)) return ids;
  const rest = ids.filter((x) => x !== id);
  const at = rest.indexOf(targetId) + (placement === 'after' ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}
