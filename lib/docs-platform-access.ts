/**
 * Docs: acceso de la IA, la API pública, el servidor MCP, Flow y Agents a las
 * páginas (tanda D4). Todo lo que lee o escribe páginas desde afuera del
 * editor pasa por acá, así hay un solo lugar con las reglas:
 *
 * - Cada página se chequea con getDocAccess (dueño, shares, herencia): nunca
 *   se devuelve ni se toca una página que la persona no podría abrir.
 * - Los listados (búsqueda, Q&A, MCP) excluyen las páginas de teamspaces que
 *   la persona no ve, y lo que lee la IA excluye además los teamspaces sin
 *   "conocimiento de IA".
 *
 * PUNTO DE INTEGRACIÓN CON D3: los teamspaces (lib/docs-access.ts:
 * hiddenTeamspaceIds, teamspaceFilterSql, aiKnowledgeFilterSql) llegan en otra
 * rama. Mientras main no los tenga, `hiddenPagesFilter` y `aiKnowledgeFilter`
 * no filtran nada (en main no hay teamspaces). Al integrar D3 se reemplaza el
 * cuerpo de esas dos funciones por:
 *
 *   hiddenPagesFilter: teamspaceFilterSql(await hiddenTeamspaceIds(ws, personId), column)
 *   aiKnowledgeFilter: aiKnowledgeFilterSql(column)
 *
 * Server-only.
 */
import { getDb, getUserById, type DocsPageRow, type UserRow } from './db';
import { getDocAccess, parseBlocks, type DocsActor } from './docs';
import type { DocsBlock } from './docs-types';
import { hydrateSyncedBlocks } from './docs-synced';

export interface SqlFilter {
  sql: string;
  args: string[];
}

/**
 * Páginas de teamspaces que `personId` no puede ver (fragmento SQL sobre
 * `column`, la columna teamspace_id de docs_pages). Sin teamspaces: vacío.
 */
export async function hiddenPagesFilter(workspaceId: string, personId: string, column = 'teamspace_id'): Promise<SqlFilter> {
  void workspaceId;
  void personId;
  void column;
  return { sql: '', args: [] };
}

/** Lo que la IA no puede leer como conocimiento (teamspaces cerrados o privados sin ai_knowledge). */
export function aiKnowledgeFilter(column = 'teamspace_id'): string {
  void column;
  return '';
}

/** Actor de Docs para una persona que actúa en el workspace `ws` (API key, Flow, agente). */
export async function docsActorFor(ws: string, personId: string): Promise<DocsActor | null> {
  const owner = await getUserById(ws);
  if (!owner) return null;
  if (personId === ws) return { ...owner };
  const person = await getUserById(personId);
  return person ? { ...owner, actingUser: person as UserRow } : { ...owner };
}

export function actorPersonId(actor: DocsActor): string {
  return actor.actingUser?.id ?? actor.id;
}

export type PlatformAccess = 'owner' | 'edit' | 'view';

/** Página + acceso de la persona, o null (no existe, no la ve o está en un teamspace oculto). */
export async function pageFor(
  actor: DocsActor,
  pageId: string,
  opts: { write?: boolean; includeArchived?: boolean } = {},
): Promise<{ row: DocsPageRow; access: PlatformAccess } | null> {
  if (!pageId || pageId.length > 100) return null;
  const hidden = await hiddenPagesFilter(actor.id, actorPersonId(actor));
  const row = (await getDb()
    .prepare(`SELECT * FROM docs_pages WHERE id = ?${hidden.sql}`)
    .get(pageId, ...hidden.args)) as DocsPageRow | undefined;
  if (!row) return null;
  if (row.archived === 1 && !opts.includeArchived) return null;
  // La publicación en el centro de ayuda no cuenta: desde afuera del editor
  // solo valen el dueño y los shares de persona o equipo.
  const access = (await getDocAccess(row, actor, { includePublished: false, includePublicLink: false })) as PlatformAccess | null;
  if (!access) return null;
  if (opts.write && access === 'view') return null;
  return { row, access };
}

/**
 * Páginas del workspace que la persona puede leer, para listados y búsqueda
 * (más nuevas primero). `forAi` excluye además lo que la IA no puede usar.
 */
export async function readablePageRows(
  actor: DocsActor,
  opts: { forAi?: boolean; limit?: number; withContent?: boolean } = {},
): Promise<DocsPageRow[]> {
  const hidden = await hiddenPagesFilter(actor.id, actorPersonId(actor));
  const ai = opts.forAi ? aiKnowledgeFilter() : '';
  const cols = opts.withContent === false ? 'id, user_id, parent_id, title, icon, archived, updated_at, created_at' : '*';
  const rows = (await getDb()
    .prepare(`SELECT ${cols} FROM docs_pages WHERE user_id = ? AND archived = 0${hidden.sql}${ai} ORDER BY updated_at DESC LIMIT ?`)
    .all(actor.id, ...hidden.args, Math.min(Math.max(opts.limit ?? 500, 1), 2000))) as DocsPageRow[];
  // Hoy la persona es dueña o miembro del workspace (ve todo); con D3 los
  // roles por página pueden dejar alguna afuera: se confirma una por una.
  const out: DocsPageRow[] = [];
  for (const r of rows) {
    if (r.user_id === actor.id && !actor.actingUser) {
      out.push(r);
      continue;
    }
    const access = await getDocAccess({ ...r, content: r.content ?? '[]' } as DocsPageRow, actor, { includePublished: false, includePublicLink: false });
    if (access) out.push(r);
  }
  return out;
}

/**
 * Para quién se lee el contenido: una persona (API, MCP, Flow, la IA que le
 * responde a ella) o el conocimiento de un agente (páginas que le dieron).
 */
export type PlatformAudience = { actor: DocsActor } | { knowledge: Iterable<string> };

/**
 * Bloques de una página tal como los puede ver `audience`. Todo lo que lee
 * contenido para la API, el MCP, Flow, la IA o Agents pasa por acá, nunca
 * por `content` crudo.
 *
 * PUNTO DE INTEGRACIÓN CON D3: con lib/docs-visible.ts en main, el cuerpo es
 *   return visibleBlocks({ id: host.id, user_id: host.user_id }, content, audience);
 * (los bloques sincronizados se resuelven con los permisos de la audiencia).
 * Hoy, como en main, se completan los sincronizados del workspace.
 */
export async function visibleBlocksFor(
  host: Pick<DocsPageRow, 'id' | 'user_id'>,
  content: string | null | undefined,
  audience: PlatformAudience,
): Promise<DocsBlock[]> {
  void audience;
  return hydrateSyncedBlocks(host.user_id, parseBlocks(content));
}
