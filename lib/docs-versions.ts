import { getDb, type DocsPageRow } from './db';
import { parseBlocks, updateDocPage } from './docs';
import type { DocsBlock, DocsVersionSummary } from './docs-types';
import { stripSyncedChildren } from './docs-synced-refs';

/**
 * Historial de versiones de Docs.
 * - Al guardar contenido/título se guarda un snapshot del estado nuevo, como
 *   mucho uno cada AUTO_INTERVAL_MS por página (los autosaves del editor
 *   llegan cada ~600 ms mientras se escribe).
 * - "Guardar versión" fuerza un snapshot manual.
 * - Restaurar guarda primero el estado actual (kind 'restore'), así nunca se
 *   pierde nada, y después pisa título/ícono/contenido con la versión.
 * - Se conservan las últimas MAX_VERSIONS por página.
 */

export const AUTO_INTERVAL_MS = 5 * 60 * 1000;
export const MAX_VERSIONS = 50;

export type DocsVersionKind = 'auto' | 'manual' | 'restore';

interface DocsVersionRow {
  id: string;
  page_id: string;
  user_id: string;
  author_id: string | null;
  title: string;
  icon: string | null;
  content: string;
  kind: DocsVersionKind;
  created_at: string;
}

export interface DocsVersion extends DocsVersionSummary {
  icon: string | null;
  content: DocsBlock[];
}

async function pageRow(ownerId: string, pageId: string): Promise<DocsPageRow | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ? AND user_id = ?')
    .get(pageId, ownerId)) as DocsPageRow | undefined;
  return row ?? null;
}

async function insertSnapshot(
  page: Pick<DocsPageRow, 'id' | 'user_id' | 'title' | 'icon' | 'content'>,
  authorId: string | null,
  kind: DocsVersionKind,
  at = new Date(),
): Promise<string> {
  const id = crypto.randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO docs_versions (id, page_id, user_id, author_id, title, icon, content, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, page.id, page.user_id, authorId, page.title, page.icon, page.content, kind, at.toISOString());
  await pruneVersions(page.id);
  return id;
}

async function pruneVersions(pageId: string): Promise<void> {
  await getDb()
    .prepare(
      `DELETE FROM docs_versions WHERE page_id = ? AND id NOT IN (
         SELECT id FROM docs_versions WHERE page_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
       )`,
    )
    .run(pageId, pageId, MAX_VERSIONS);
}

/** Snapshot manual ("Guardar versión"). */
export async function saveDocVersion(
  ownerId: string,
  pageId: string,
  authorId: string | null,
  kind: DocsVersionKind = 'manual',
): Promise<string | null> {
  const page = await pageRow(ownerId, pageId);
  if (!page) return null;
  return insertSnapshot(page, authorId, kind);
}

/**
 * Snapshot automático tras un guardado. `previous` es la fila antes de
 * aplicar el cambio: si la página nunca tuvo versiones se guarda también ese
 * estado original (si no, la primera edición lo perdía).
 */
export async function maybeAutoSnapshot(
  ownerId: string,
  pageId: string,
  authorId: string | null,
  previous?: Pick<DocsPageRow, 'id' | 'user_id' | 'title' | 'icon' | 'content' | 'updated_at'> | null,
  now = new Date(),
): Promise<boolean> {
  const last = (await getDb()
    .prepare('SELECT created_at FROM docs_versions WHERE page_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get(pageId)) as { created_at: string } | undefined;
  if (last && now.getTime() - Date.parse(last.created_at) < AUTO_INTERVAL_MS) return false;
  const page = await pageRow(ownerId, pageId);
  if (!page) return false;
  if (!last && previous && (previous.content !== page.content || previous.title !== page.title)) {
    const prevAt = Date.parse(previous.updated_at);
    const at = Number.isFinite(prevAt) && prevAt < now.getTime() ? new Date(prevAt) : new Date(now.getTime() - 1000);
    await insertSnapshot(previous, null, 'auto', at);
  }
  await insertSnapshot(page, authorId, 'auto', now);
  return true;
}

export async function listDocVersions(ownerId: string, pageId: string): Promise<DocsVersionSummary[]> {
  return (await getDb()
    .prepare(
      `SELECT v.id, v.page_id, v.title, v.kind, v.author_id, v.created_at,
              u.name AS author_name, u.email AS author_email
       FROM docs_versions v
       LEFT JOIN users u ON u.id = v.author_id
       WHERE v.page_id = ? AND v.user_id = ?
       ORDER BY v.created_at DESC, v.rowid DESC`,
    )
    .all(pageId, ownerId)) as DocsVersionSummary[];
}

export async function getDocVersion(ownerId: string, pageId: string, versionId: string): Promise<DocsVersion | null> {
  const row = (await getDb()
    .prepare(
      `SELECT v.*, u.name AS author_name, u.email AS author_email
       FROM docs_versions v
       LEFT JOIN users u ON u.id = v.author_id
       WHERE v.id = ? AND v.page_id = ? AND v.user_id = ?`,
    )
    .get(versionId, pageId, ownerId)) as (DocsVersionRow & { author_name: string | null; author_email: string | null }) | undefined;
  if (!row) return null;
  return {
    id: row.id,
    page_id: row.page_id,
    title: row.title,
    icon: row.icon,
    kind: row.kind,
    author_id: row.author_id,
    author_name: row.author_name,
    author_email: row.author_email,
    created_at: row.created_at,
    content: parseBlocks(row.content),
  };
}

/** Restaura una versión: guarda el estado actual y pisa título/ícono/contenido. */
export async function restoreDocVersion(
  ownerId: string,
  pageId: string,
  versionId: string,
  authorId: string | null,
): Promise<boolean> {
  const version = await getDocVersion(ownerId, pageId, versionId);
  if (!version) return false;
  const page = await pageRow(ownerId, pageId);
  if (!page) return false;
  await insertSnapshot(page, authorId, 'restore');
  // Los sincronizados vuelven como referencia: restaurar no pisa su contenido compartido.
  await updateDocPage(ownerId, pageId, { title: version.title, icon: version.icon, content: stripSyncedChildren(version.content) }, { actorId: authorId });
  return true;
}
