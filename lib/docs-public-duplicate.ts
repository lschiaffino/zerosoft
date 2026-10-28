/**
 * Docs D5: "Duplicar" una página publicada a tu workspace (como "Duplicate as
 * template" de Notion). Solo si el dueño prendió "Permitir duplicar" en esa
 * página. Se copia exactamente lo que el sitio muestra al público:
 *
 * - la página y sus subpáginas publicadas (las no publicadas no salen);
 * - bloques sincronizados con su contenido solo si su origen está publicado
 *   (lib/docs-visible.ts, audiencia pública), y copiados como bloques
 *   propios (sin seguir sincronizados con el workspace de origen);
 * - sin sugerencias, comentarios, historial ni permisos;
 * - links `[[` a páginas copiadas → a la copia; al resto, texto plano.
 */
import { getDb, type DocsPageRow } from './db';
import { cleanContent, createDocPage, parseBlocks, stringifyBlocks } from './docs';
import { visibleBlocks } from './docs-visible';
import { cleanForReaders } from './docs-marks';
import { pageLinkHref, resolveBlocksPageLinks } from './docs-page-links';
import { blockIndent } from './docs-blocks';
import type { DocsBlock } from './docs-types';

/** Tope de páginas por duplicado. */
export const DUPLICATE_MAX_PAGES = 200;

/** Saca los contenedores sincronizados y deja su contenido como bloques propios. */
export function detachSynced(blocks: DocsBlock[]): DocsBlock[] {
  if (!blocks.some((b) => b.type === 'synced')) return blocks;
  const out: DocsBlock[] = [];
  const stack: Array<{ indent: number; synced: boolean }> = [];
  for (const b of blocks) {
    const d = blockIndent(b);
    while (stack.length && stack[stack.length - 1].indent >= d) stack.pop();
    const shift = stack.filter((x) => x.synced).length;
    stack.push({ indent: d, synced: b.type === 'synced' });
    if (b.type === 'synced') continue;
    const { synced_id: _sid, synced_at: _sat, ...rest } = b as DocsBlock & { synced_at?: unknown };
    void _sid;
    void _sat;
    const nd = d - shift;
    out.push(nd > 0 ? { ...rest, indent: nd } : { ...rest, indent: undefined });
  }
  return out;
}

export interface PublicSource {
  workspaceId: string;
  row: DocsPageRow;
}

/** La página publicada que se puede duplicar (o null). */
export async function duplicableSource(workspaceId: string, slug: string): Promise<PublicSource | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE user_id = ? AND slug = ? AND published = 1 AND archived = 0')
    .get(workspaceId, slug)) as DocsPageRow | undefined;
  if (!row || (row as DocsPageRow & { allow_duplicate?: number }).allow_duplicate !== 1) return null;
  return { workspaceId, row };
}

/** Subpáginas publicadas del árbol (por madres publicadas), en orden. */
async function publishedSubtree(workspaceId: string, rootId: string): Promise<DocsPageRow[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE user_id = ? AND published = 1 AND archived = 0 ORDER BY (position IS NULL) ASC, position ASC, created_at ASC')
    .all(workspaceId)) as DocsPageRow[];
  const byParent = new Map<string, DocsPageRow[]>();
  for (const r of rows) if (r.parent_id) byParent.set(r.parent_id, [...(byParent.get(r.parent_id) ?? []), r]);
  const out: DocsPageRow[] = [];
  const seen = new Set([rootId]);
  const walk = (id: string) => {
    for (const k of byParent.get(id) ?? []) {
      if (seen.has(k.id) || out.length >= DUPLICATE_MAX_PAGES - 1) continue;
      seen.add(k.id);
      out.push(k);
      walk(k.id);
    }
  };
  walk(rootId);
  return out;
}

/**
 * Copia la página publicada (y sus subpáginas publicadas) al workspace
 * `targetWs`, arriba de todo o en el teamspace indicado. Devuelve el id de la copia.
 */
export async function duplicatePublished(source: PublicSource, targetWs: string, teamspaceId: string | null): Promise<{ id: string; pages: number }> {
  const all = [source.row, ...(await publishedSubtree(source.workspaceId, source.row.id))];
  // Primero las páginas (madres antes que hijas), así los links pueden apuntar a cualquiera de las copias.
  const created = new Map<string, string>();
  for (const r of all) {
    const parentId = r.id === source.row.id ? null : r.parent_id ? (created.get(r.parent_id) ?? null) : null;
    const page = await createDocPage(targetWs, {
      title: r.title,
      icon: r.icon,
      cover_url: r.cover_url,
      parent_id: parentId,
      teamspace_id: parentId ? null : teamspaceId,
      content: parseBlocks('[]'),
    });
    created.set(r.id, page.id);
  }
  for (const r of all) {
    const raw = cleanForReaders(await visibleBlocks(r, r.content, { public: true }));
    const blocks = resolveBlocksPageLinks(detachSynced(raw), (id) => {
      const target = created.get(id);
      return target ? { href: pageLinkHref(target), title: null } : null;
    }).map((b) => {
      if (!b.content?.includes('data-page')) return b;
      let content = b.content;
      for (const [oldId, newId] of created) content = content.split(`data-page="${oldId}"`).join(`data-page="${newId}"`);
      return { ...b, content };
    });
    const content = stringifyBlocks(cleanContent(blocks.length ? blocks : parseBlocks('[]')));
    await getDb().prepare('UPDATE docs_pages SET content = ? WHERE id = ? AND user_id = ?').run(content, created.get(r.id) ?? '', targetWs);
  }
  return { id: created.get(source.row.id)!, pages: created.size };
}
