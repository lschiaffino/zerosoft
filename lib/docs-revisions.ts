/**
 * Últimas versiones guardadas de una página (docs_page_revisions): la base
 * de la fusión de tres vías cuando un editor guarda sobre una versión vieja
 * (ver lib/docs-merge.ts). Se guardan las últimas 12 por página.
 */
import { getDb, type DocsPageRow } from './db';

export interface DocsRevision {
  updated_at: string;
  title: string;
  icon: string | null;
  cover_url: string | null;
  content: string;
  /** Lo que el editor vio de cada sincronizado en esta versión (id → JSON). */
  synced_seen?: string | null;
}

const KEEP = 12;

export async function getRevision(pageId: string, updatedAt: string): Promise<DocsRevision | null> {
  return (
    ((await getDb()
      .prepare('SELECT updated_at, title, icon, cover_url, content, synced_seen FROM docs_page_revisions WHERE page_id = ? AND updated_at = ?')
      .get(pageId, updatedAt)) as DocsRevision | undefined) ?? null
  );
}

/**
 * Deja registradas la versión anterior (si no estaba: páginas de antes de la
 * tabla o creadas por otra ruta) y la nueva de un guardado.
 */
export async function recordRevisions(
  prev: Pick<DocsPageRow, 'id' | 'updated_at' | 'title' | 'icon' | 'cover_url' | 'content'>,
  next: Omit<DocsRevision, 'content'> & { content: string },
): Promise<void> {
  const db = getDb();
  const insert = 'INSERT OR IGNORE INTO docs_page_revisions (page_id, updated_at, title, icon, cover_url, content, synced_seen) VALUES (?, ?, ?, ?, ?, ?, ?)';
  const had = await db.prepare('SELECT 1 FROM docs_page_revisions WHERE page_id = ? AND updated_at = ?').get(prev.id, prev.updated_at);
  if (!had) await db.prepare(insert).run(prev.id, prev.updated_at, prev.title ?? '', prev.icon ?? null, prev.cover_url ?? null, prev.content ?? '[]', null);
  // La nueva manda (si cae en el mismo milisegundo que la anterior, la reemplaza).
  await db.prepare(insert.replace('INSERT OR IGNORE', 'INSERT OR REPLACE')).run(prev.id, next.updated_at, next.title ?? '', next.icon ?? null, next.cover_url ?? null, next.content, next.synced_seen ?? null);
  await db
    .prepare(
      `DELETE FROM docs_page_revisions WHERE page_id = ? AND updated_at NOT IN (
         SELECT updated_at FROM docs_page_revisions WHERE page_id = ? ORDER BY updated_at DESC LIMIT ${KEEP})`,
    )
    .run(prev.id, prev.id);
}
