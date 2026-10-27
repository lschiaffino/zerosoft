/**
 * Contenido de una página tal como lo puede ver alguien: la única entrada
 * para todo lo que muestra, busca o resume texto de Docs fuera del editor
 * (versiones, export, centro de ayuda, bots, agentes).
 *
 * El content guardado tiene los bloques sincronizados solo como referencia
 * (lib/docs-synced-refs.ts); acá se completan con su contenido si quien mira
 * puede abrir la página de origen, o quedan vacíos con `no_access`. Cualquier
 * copia de hijos que traiga la lista (versiones viejas, plantillas, lo que
 * mande un cliente) se descarta antes.
 */
import type { DocsPageRow } from './db';
import { parseBlocks, type DocsActor } from './docs';
import { hydrateSyncedBlocks, type SyncedReader } from './docs-synced';
import { knowledgeSyncedReader, publicSyncedReader, syncedReader } from './docs-guard';
import type { DocsBlock } from './docs-types';
import { getDb } from './db';
import { hiddenLinkIds } from './docs';
import { maskPageLinks, pageLinkIds } from './docs-page-links';
import { withDatabaseBodies } from './docs-types';
import { requestHiddenLabel } from './docs-hidden-label';

/** Quién mira: una persona (o invitado), el público del centro de ayuda o la IA (bots y agentes). */
export type DocsAudience = { actor: DocsActor } | { public: true } | { knowledge: Iterable<string> };

type Host = Pick<DocsPageRow, 'id' | 'user_id'>;

export function readerFor(audience: DocsAudience, host: Host): SyncedReader {
  if ('actor' in audience) return syncedReader(audience.actor, host);
  if ('public' in audience) return publicSyncedReader(host);
  return knowledgeSyncedReader(host, audience.knowledge);
}

/** Bloques visibles de `content` (JSON guardado o bloques) de la página `host`. */
export async function visibleBlocks(host: Host, content: string | DocsBlock[] | null | undefined, audience: DocsAudience): Promise<DocsBlock[]> {
  const blocks = typeof content === 'string' || content == null ? parseBlocks(content) : content;
  const out = await hydrateSyncedBlocks(host.user_id, blocks, readerFor(audience, host));
  // Links a páginas que quien lee no puede abrir: "Página privada", no el título guardado.
  if ('knowledge' in audience) return out;
  const hidden = 'actor' in audience ? await hiddenLinkIds(audience.actor, host, out) : await publicHiddenIds(out);
  if (hidden.size === 0) return out;
  return maskPageLinks(out, (id) => hidden.has(id), await requestHiddenLabel(), 'public' in audience);
}

/** Para el público: las páginas linkeadas que existen y no están publicadas. */
async function publicHiddenIds(blocks: DocsBlock[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const b of withDatabaseBodies(blocks)) for (const id of pageLinkIds(b.content ?? '')) ids.add(id);
  const hidden = new Set<string>();
  if (ids.size === 0) return hidden;
  const list = [...ids].slice(0, 500);
  const rows = (await getDb()
    .prepare(`SELECT id, published, archived FROM docs_pages WHERE id IN (${list.map(() => '?').join(', ')})`)
    .all(...list)) as Array<{ id: string; published: number; archived: number }>;
  for (const r of rows) if (r.published !== 1 || r.archived === 1) hidden.add(r.id);
  return hidden;
}

/** Lo mismo, como JSON (para los que leen el content como string: excerpts, extractDocsText). */
export async function visibleContent(host: Host, content: string | null | undefined, audience: DocsAudience): Promise<string> {
  if (!content || (!content.includes('"synced"') && (!content.includes('data-page') || 'knowledge' in audience))) return content ?? '[]';
  return JSON.stringify(await visibleBlocks(host, content, audience));
}

/** Varias páginas: el `content` de cada una pasa a ser el visible. */
export async function withVisibleContent<T extends { id: string; content: string }>(
  workspaceId: string,
  rows: T[],
  audience: DocsAudience,
): Promise<T[]> {
  return Promise.all(rows.map(async (r) => ({ ...r, content: await visibleContent({ id: r.id, user_id: workspaceId }, r.content, audience) })));
}
