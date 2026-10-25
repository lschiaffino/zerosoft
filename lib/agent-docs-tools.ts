/**
 * Agents: herramientas de Docs (tanda D4, como los Custom Agents de Notion).
 * Un agente trabaja solo con las páginas que el dueño le dio (tools.docsPageIds)
 * y sus subpáginas: las lee, les agrega o reemplaza contenido, crea subpáginas
 * y agrega o cambia filas de sus bases. Nada de afuera de ese árbol, nada de
 * teamspaces sin conocimiento de IA, y nada de bases sincronizadas.
 *
 * Cada llamada queda en agent_tool_calls (lib/agent-tools.ts) y cada cambio en
 * el historial de la página. Las escrituras pueden pedir aprobación.
 * Server-only.
 */
import { getDb } from './db';
import { collectDescendants } from './docs';
import { aiKnowledgeFilter, docsActorFor, pageFor } from './docs-platform-access';
import type { DocsActor } from './docs';
import { DocsPlatformError } from './docs-platform';

type Out = Record<string, unknown>;

/**
 * Páginas que el agente puede usar: las elegidas y sus subpáginas (no
 * archivadas, con conocimiento de IA) que puede abrir la persona con cuyos
 * permisos trabaja el agente.
 */
export async function agentDocsScope(ws: string, roots: string[], actor?: DocsActor | null): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const r of roots.slice(0, 50)) for (const id of await collectDescendants(ws, r)) ids.add(id);
  if (!ids.size) return ids;
  const list = [...ids].slice(0, 2000);
  const rows = (await getDb()
    .prepare(`SELECT id FROM docs_pages WHERE user_id = ? AND archived = 0 AND id IN (${list.map(() => '?').join(',')})${aiKnowledgeFilter()}`)
    .all(ws, ...list)) as Array<{ id: string }>;
  if (actor === undefined) return new Set(rows.map((r) => r.id));
  const out = new Set<string>();
  if (!actor) return out;
  for (const r of rows) if (await pageFor(actor, r.id)) out.add(r.id);
  return out;
}

function platformError(err: unknown): Out {
  if (err instanceof DocsPlatformError) return { error: err.code.split(':')[0], ...(err.code.includes(':') ? { detail: err.code.split(':')[1] } : {}) };
  throw err;
}

/** La persona con cuyos permisos trabaja el agente en Docs (null si no hay o ya no es del workspace). */
async function agentActor(ws: string, actorId: string | null): Promise<DocsActor | null> {
  return actorId ? docsActorFor(ws, actorId) : null;
}

/** docs_read_pages: lista, busca o lee una página (con sus bases y filas). */
export async function readDocsForAgent(ws: string, roots: string[], input: { query?: string; pageId?: string }, actorId: string | null): Promise<Out> {
  const actor = await agentActor(ws, actorId);
  if (!actor) return { error: 'docs_owner_missing' };
  const scope = await agentDocsScope(ws, roots, actor);
  if (!scope.size) return { error: 'no_pages_configured' };
  const platform = await import('./docs-platform');
  try {
    if (input.pageId) {
      if (!scope.has(input.pageId)) return { error: 'page_not_allowed' };
      // Conocimiento del agente: solo lo de su árbol de páginas.
      const page = await platform.getPage(actor, input.pageId, { audience: { knowledge: scope } });
      const databases = [];
      for (const d of page.databases.slice(0, 5)) {
        const db = await platform.getDatabase(actor, page.id, d.blockId);
        const rows = await platform.queryRows(actor, page.id, d.blockId, { limit: 50 });
        databases.push({
          blockId: d.blockId,
          title: db.title,
          readOnly: Boolean(db.synced),
          properties: db.properties.map((p) => ({ name: p.name, type: p.type, ...(p.options ? { options: p.options } : {}) })),
          rows: rows.rows.map((r) => ({ id: r.id, title: r.title, properties: r.properties })),
          totalRows: rows.total,
        });
      }
      const subpages = (await getDb().prepare('SELECT id, title FROM docs_pages WHERE user_id = ? AND parent_id = ? AND archived = 0 LIMIT 50').all(ws, page.id)) as Array<{ id: string; title: string }>;
      return {
        page: { id: page.id, title: page.title, url: page.url, updatedAt: page.updatedAt },
        markdown: page.markdown.slice(0, 12_000),
        ...(page.markdown.length > 12_000 ? { truncated: true } : {}),
        databases,
        subpages: subpages.filter((p) => scope.has(p.id)),
      };
    }
    if (input.query?.trim()) {
      const hits = (await platform.searchPages(actor, input.query, 40)).filter((h) => scope.has(h.page.id)).slice(0, 10);
      return {
        results: hits.map((h) => ({ pageId: h.page.id, title: h.rowTitle ?? h.page.title, ...(h.rowId ? { rowId: h.rowId, inPage: h.page.title } : {}), snippet: h.snippet })),
        ...(hits.length === 0 ? { note: 'no matching pages' } : {}),
      };
    }
    const rows = (await getDb()
      .prepare(`SELECT id, title, parent_id FROM docs_pages WHERE user_id = ? AND id IN (${[...scope].slice(0, 200).map(() => '?').join(',')}) ORDER BY updated_at DESC`)
      .all(ws, ...[...scope].slice(0, 200))) as Array<{ id: string; title: string; parent_id: string | null }>;
    return { pages: rows.map((r) => ({ id: r.id, title: r.title || 'Untitled', parentId: r.parent_id })) };
  } catch (err) {
    return platformError(err);
  }
}

export interface DocsPageWriteInput {
  operation: 'create' | 'append' | 'replace' | 'rename';
  pageId?: string;
  parentId?: string;
  title?: string;
  markdown?: string;
}

export interface DocsRowWriteInput {
  pageId: string;
  blockId: string;
  rowId?: string;
  title?: string;
  properties?: Record<string, string>;
  markdown?: string;
}

/** Valida una escritura de página contra el árbol del agente. null si está bien, o el error. */
export async function checkPageWrite(ws: string, roots: string[], input: DocsPageWriteInput, actorId: string | null): Promise<Out | null> {
  const actor = await agentActor(ws, actorId);
  if (!actor) return { error: 'docs_owner_missing' };
  const scope = await agentDocsScope(ws, roots, actor);
  if (!scope.size) return { error: 'no_pages_configured' };
  if (input.operation === 'create') {
    const parent = input.parentId || roots.find((r) => scope.has(r));
    if (!parent || !scope.has(parent)) return { error: 'page_not_allowed' };
    if (!input.title?.trim() && !input.markdown?.trim()) return { error: 'missing_content' };
    // Sin padre: la primera página del agente.
    input.parentId = parent;
    return null;
  }
  if (!input.pageId || !scope.has(input.pageId)) return { error: 'page_not_allowed' };
  if (input.operation === 'rename' ? !input.title?.trim() : !input.markdown?.trim()) return { error: 'missing_content' };
  return null;
}

export async function checkRowWrite(ws: string, roots: string[], input: DocsRowWriteInput, actorId: string | null): Promise<Out | null> {
  const actor = await agentActor(ws, actorId);
  if (!actor) return { error: 'docs_owner_missing' };
  const scope = await agentDocsScope(ws, roots, actor);
  if (!scope.has(input.pageId)) return { error: 'page_not_allowed' };
  return null;
}

/** Ejecuta docs_write_page (ya validado o revalidando al aprobar). */
export async function writePageForAgent(ws: string, roots: string[], input: DocsPageWriteInput, agentName: string, actorId: string | null): Promise<Out> {
  const bad = await checkPageWrite(ws, roots, input, actorId);
  if (bad) return bad;
  const platform = await import('./docs-platform');
  const actor = (await agentActor(ws, actorId))!;
  try {
    if (input.operation === 'create') {
      const page = await platform.createPage(actor, { title: input.title, parentId: input.parentId, markdown: input.markdown });
      return { created: true, page: { id: page.id, title: page.title, url: page.url }, by: agentName };
    }
    const page = await platform.updatePage(
      actor,
      input.pageId!,
      input.operation === 'rename' ? { title: input.title } : input.operation === 'replace' ? { markdown: input.markdown } : { appendMarkdown: input.markdown },
    );
    return { updated: true, operation: input.operation, page: { id: page.id, title: page.title, url: page.url } };
  } catch (err) {
    return platformError(err);
  }
}

/** Ejecuta docs_write_row: fila nueva o cambios en una fila. */
export async function writeRowForAgent(ws: string, roots: string[], input: DocsRowWriteInput, actorId: string | null): Promise<Out> {
  const bad = await checkRowWrite(ws, roots, input, actorId);
  if (bad) return bad;
  const platform = await import('./docs-platform');
  const actor = (await agentActor(ws, actorId))!;
  try {
    const row = input.rowId
      ? await platform.updateRow(actor, input.pageId, input.blockId, input.rowId, { title: input.title, values: input.properties, appendMarkdown: input.markdown })
      : await platform.createRow(actor, input.pageId, input.blockId, { title: input.title, values: input.properties, markdown: input.markdown });
    return { [input.rowId ? 'updated' : 'created']: true, row: { id: row.id, title: row.title, url: row.url, properties: row.properties } };
  } catch (err) {
    return platformError(err);
  }
}
