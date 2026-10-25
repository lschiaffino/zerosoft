import { getDb } from './db';
import { blockIndent, setIndent, subtreeEnd } from './docs-blocks';
import { sanitizeBlocks } from './docs-sanitize';
import { stripSyncedChildren, syncedIdsOf } from './docs-synced-refs';
import { mergeBlocksDetailed } from './docs-merge';
import type { DocsBlock } from './docs-types';

/**
 * Bloques sincronizados de Docs (como los de Notion): un bloque `synced` con
 * `synced_id` y sus hijos en la lista plana. El contenido vive en
 * docs_synced_blocks (por workspace): al guardar una página, lo que la persona
 * editó adentro de un bloque sincronizado se escribe ahí; al abrir cualquier
 * página que lo usa, sus hijos salen de esa tabla según quién mira. El content
 * de la página guarda solo la referencia (lib/docs-synced-refs.ts): todo lo
 * que muestre texto de una página lo lee con lib/docs-visible.ts.
 */

export const SYNCED_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_SYNCED_BLOCKS = 500;

interface SyncedRow {
  id: string;
  workspace_id: string;
  content: string;
}

function parse(raw: string): DocsBlock[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as DocsBlock[]) : [];
  } catch {
    return [];
  }
}

/** Contenido de bloques sincronizados del workspace por id. */
export async function getSyncedContents(workspaceId: string, ids: string[]): Promise<Map<string, DocsBlock[]>> {
  const out = new Map<string, DocsBlock[]>();
  const unique = [...new Set(ids.filter((id) => SYNCED_ID_RE.test(id)))];
  if (!unique.length) return out;
  const rows = (await getDb()
    .prepare(`SELECT id, workspace_id, content FROM docs_synced_blocks WHERE workspace_id = ? AND id IN (${unique.map(() => '?').join(',')})`)
    .all(workspaceId, ...unique)) as SyncedRow[];
  for (const r of rows) out.set(r.id, parse(r.content));
  return out;
}

/** Última edición de cada bloque sincronizado del workspace (versión que ve el editor). */
export async function getSyncedVersions(workspaceId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids.filter((id) => SYNCED_ID_RE.test(id)))];
  if (!unique.length) return out;
  const rows = (await getDb()
    .prepare(`SELECT id, updated_at FROM docs_synced_blocks WHERE workspace_id = ? AND id IN (${unique.map(() => '?').join(',')})`)
    .all(workspaceId, ...unique)) as Array<{ id: string; updated_at: string }>;
  for (const r of rows) out.set(r.id, r.updated_at);
  return out;
}

const HISTORY_KEEP = 20;

/** Guarda una versión del contenido de un sincronizado (base de la fusión de guardados viejos). */
async function recordSyncedHistory(workspaceId: string, id: string, updatedAt: string, json: string): Promise<void> {
  const db = getDb();
  await db
    .prepare('INSERT OR REPLACE INTO docs_synced_history (synced_id, workspace_id, updated_at, content) VALUES (?, ?, ?, ?)')
    .run(id, workspaceId, updatedAt, json)
    .catch(() => undefined);
  await db
    .prepare(
      `DELETE FROM docs_synced_history WHERE synced_id = ? AND updated_at NOT IN (
         SELECT updated_at FROM docs_synced_history WHERE synced_id = ? ORDER BY updated_at DESC LIMIT ${HISTORY_KEEP})`,
    )
    .run(id, id)
    .catch(() => undefined);
}

async function syncedAtVersion(workspaceId: string, id: string, updatedAt: string): Promise<DocsBlock[] | null> {
  const row = (await getDb()
    .prepare('SELECT content FROM docs_synced_history WHERE synced_id = ? AND workspace_id = ? AND updated_at = ?')
    .get(id, workspaceId, updatedAt)
    .catch(() => undefined)) as { content: string } | undefined;
  return row ? parse(row.content) : null;
}

/** Página de origen de cada bloque sincronizado del workspace (null = se borró). */
export async function getSyncedSources(workspaceId: string, ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const unique = [...new Set(ids.filter((id) => SYNCED_ID_RE.test(id)))];
  if (!unique.length) return out;
  const rows = (await getDb()
    .prepare(`SELECT id, source_page_id FROM docs_synced_blocks WHERE workspace_id = ? AND id IN (${unique.map(() => '?').join(',')})`)
    .all(workspaceId, ...unique)) as Array<{ id: string; source_page_id: string | null }>;
  for (const r of rows) out.set(r.id, r.source_page_id ?? null);
  return out;
}

/**
 * ¿Quien mira puede ver un bloque sincronizado? Recibe la página de origen
 * (null = se borró). Lo arma lib/docs-guard.ts según quién mira.
 */
export type SyncedReader = (sourcePageId: string | null) => Promise<boolean>;

/** Ids de bloques sincronizados de `blocks` que quien mira no puede ver. */
export async function unreadableSyncedIds(workspaceId: string, blocks: DocsBlock[], canRead: SyncedReader): Promise<Set<string>> {
  const ids = blocks.filter((b) => b.type === 'synced' && b.synced_id).map((b) => b.synced_id!);
  const denied = new Set<string>();
  if (!ids.length) return denied;
  const sources = await getSyncedSources(workspaceId, ids).catch(() => new Map<string, string | null>());
  for (const [id, src] of sources) if (!(await canRead(src))) denied.add(id);
  return denied;
}

/** Sincronizados de primer nivel de la lista (no los que están adentro de otro). */
function topLevelSynced(blocks: DocsBlock[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== 'synced') continue;
    out.push(i);
    i = subtreeEnd(blocks, i);
  }
  return out;
}

const MAX_SYNCED_DEPTH = 4;

/**
 * Pone como hijos de cada bloque sincronizado su contenido actual (al leer una
 * página). Lo que la lista traiga adentro de un sincronizado se descarta
 * siempre: el contenido sale solo de docs_synced_blocks. Con `canRead`: si
 * quien mira no puede abrir la página de origen, el bloque queda sin hijos y
 * con `no_access` (como Notion: "no tenés acceso"). Los anidados se resuelven
 * igual, con el mismo `canRead`.
 */
export async function hydrateSyncedBlocks(workspaceId: string, blocks: DocsBlock[], canRead?: SyncedReader): Promise<DocsBlock[]> {
  return expandSynced(workspaceId, blocks, canRead, new Set(), 0);
}

async function expandSynced(
  workspaceId: string,
  blocks: DocsBlock[],
  canRead: SyncedReader | undefined,
  path: Set<string>,
  depth: number,
): Promise<DocsBlock[]> {
  const tops = topLevelSynced(blocks);
  if (!tops.length) return blocks;
  const ids = [...new Set(tops.map((i) => blocks[i].synced_id).filter((id): id is string => !!id))];
  const denied = new Set<string>();
  if (canRead && ids.length) {
    const sources = await getSyncedSources(workspaceId, ids).catch(() => new Map<string, string | null>());
    for (const [id, src] of sources) if (!(await canRead(src))) denied.add(id);
  }
  const contents = ids.length ? await getSyncedContents(workspaceId, ids).catch(() => new Map<string, DocsBlock[]>()) : new Map<string, DocsBlock[]>();
  const versions = ids.length ? await getSyncedVersions(workspaceId, ids).catch(() => new Map<string, string>()) : new Map<string, string>();
  const out: DocsBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== 'synced') {
      out.push(b);
      continue;
    }
    i = subtreeEnd(blocks, i);
    const id = b.synced_id;
    const { synced_at: _old, ...ref } = b;
    void _old;
    if (id && denied.has(id)) {
      out.push({ ...ref, no_access: true });
      continue;
    }
    const at = id ? versions.get(id) : undefined;
    out.push(at ? { ...ref, synced_at: at } : ref);
    const content = id ? contents.get(id) : undefined;
    if (!content || !id || path.has(id) || depth >= MAX_SYNCED_DEPTH) continue;
    const inner = await expandSynced(workspaceId, content, canRead, new Set([...path, id]), depth + 1);
    const base = blockIndent(b) + 1;
    out.push(...inner.map((c) => setIndent(c, blockIndent(c) + base)));
  }
  return out;
}

/**
 * Al guardar una página: escribe en docs_synced_blocks lo que cambió adentro
 * de cada bloque sincronizado y devuelve la página con solo las referencias.
 * `base` es lo que esta página tenía de cada uno la última vez que guardó
 * (docs_pages.synced_base): una página abierta con una copia vieja no pisa lo
 * que otra editó. Un id que no es del workspace (pegado de otro lado) se
 * suelta: el bloque queda como un contenedor propio con id nuevo.
 */
export async function persistSyncedBlocks(opts: {
  workspaceId: string;
  pageId: string;
  actorId: string | null;
  /** Snapshot de la página (id → JSON de los hijos que guardó). */
  base: Record<string, string>;
  /** Ids de sincronizados que la página ya tenía. */
  previousIds: Set<string>;
  /** Estructura a guardar (sincronizados sin hijos, lib/docs-synced-refs.ts). */
  next: DocsBlock[];
  /** Hijos que llegaron de cada sincronizado (por id). */
  children: Map<string, DocsBlock[]>;
  /**
   * Sincronizados que quien guarda no puede ver (le llegaron sin hijos): su
   * contenido no se toca y lo que llegue adentro se descarta.
   */
  locked?: Set<string>;
  /**
   * Versión de cada sincronizado que vio el editor (synced_at de lo que
   * cargó). Si cambió desde entonces en otra página, lo que llega se fusiona
   * contra esa versión (docs_synced_history): lo que no tocó quien guarda no
   * pisa lo editado después.
   */
  seenAt?: Map<string, string>;
}): Promise<{ blocks: DocsBlock[]; base: Record<string, string> }> {
  const { workspaceId, pageId, actorId, base, previousIds, children } = opts;
  const locked = opts.locked ?? new Set<string>();
  const nextBase: Record<string, string> = {};
  const candidates = [...new Set([...syncedIdsOf(opts.next), ...children.keys(), ...[...children.values()].flatMap(syncedIdsOf)])];
  if (!candidates.length) return { blocks: opts.next, base: nextBase };
  const owned = await getSyncedContents(workspaceId, candidates);
  const ownedAt = await getSyncedVersions(workspaceId, candidates);
  const foreign = new Set<string>();
  const valid = candidates.filter((id) => SYNCED_ID_RE.test(id));
  if (valid.length) {
    const rows = (await getDb()
      .prepare(`SELECT id FROM docs_synced_blocks WHERE workspace_id != ? AND id IN (${valid.map(() => '?').join(',')})`)
      .all(workspaceId, ...valid)) as Array<{ id: string }>;
    for (const r of rows) foreign.add(r.id);
  }
  const now = new Date().toISOString();
  const written = new Set<string>();
  const db = getDb();
  const insert = async (id: string, json: string) => {
    const res = await db
      .prepare(
        `INSERT INTO docs_synced_blocks (id, workspace_id, source_page_id, content, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      )
      .run(id, workspaceId, pageId, json, actorId, now, now);
    if (res.changes) await recordSyncedHistory(workspaceId, id, now, json);
  };

  const process = async (list: DocsBlock[], depth: number): Promise<DocsBlock[]> => {
    const out = stripSyncedChildren(list).map((b) => {
      if (!b.no_access && !b.synced_at) return b;
      const { no_access: _n, synced_at: _a, ...clean } = b;
      void _n;
      void _a;
      return clean;
    });
    for (let i = 0; i < out.length; i++) {
      const b = out[i];
      if (b.type !== 'synced') continue;
      const orig = b.synced_id;
      // Uno sin acceso que no estaba en la página (pegado sabiendo el id): bloque propio nuevo.
      const lockedNew = !!orig && locked.has(orig) && !previousIds.has(orig);
      let id = orig && SYNCED_ID_RE.test(orig) && !foreign.has(orig) && !lockedNew ? orig : null;
      if (!id) {
        id = crypto.randomUUID();
        out[i] = { ...b, synced_id: id };
      }
      if (locked.has(id) || written.has(id)) {
        if (base[id] !== undefined && nextBase[id] === undefined) nextBase[id] = base[id];
        continue;
      }
      const kids = orig && !lockedNew ? children.get(orig) : undefined;
      if (kids === undefined) {
        // Vino de lo guardado (la fusión) o sin hijos: el contenido no cambia.
        if (base[id] !== undefined) nextBase[id] = base[id];
        if (id !== orig && !owned.has(id)) {
          written.add(id);
          await insert(id, '[]');
        }
        continue;
      }
      written.add(id);
      const fixed = depth < MAX_SYNCED_DEPTH ? await process(kids, depth + 1) : stripSyncedChildren(kids);
      const clean = sanitizeBlocks(fixed.filter((c) => c.type !== 'database')).slice(0, MAX_SYNCED_BLOCKS);
      let json = JSON.stringify(clean);
      if (!owned.has(id)) {
        nextBase[id] = json;
        await insert(id, json);
        continue;
      }
      const ownedJson = JSON.stringify(owned.get(id));
      const sawAt = opts.seenAt?.get(id);
      const seenBlocks = sawAt && sawAt !== ownedAt.get(id) ? await syncedAtVersion(workspaceId, id, sawAt) : null;
      const seenJson = seenBlocks ? JSON.stringify(seenBlocks) : sawAt && sawAt === ownedAt.get(id) ? ownedJson : undefined;
      if (seenJson !== undefined && seenJson !== ownedJson) {
        // Cambió en otra página desde que este editor lo cargó.
        if (seenJson === json) {
          // Quien guarda no lo tocó: queda lo actual.
          nextBase[id] = ownedJson;
          continue;
        }
        // Los dos lo cambiaron: fusión de tres vías contra lo que vio.
        json = JSON.stringify(sanitizeBlocks(mergeBlocksDetailed(seenBlocks ?? [], owned.get(id)!, clean).blocks).slice(0, MAX_SYNCED_BLOCKS));
      }
      nextBase[id] = json;
      // Solo si cambió en esta página (no si es la copia que ya traía).
      if (seenJson === undefined && base[id] === json) continue;
      if (ownedJson === json) continue;
      await db
        .prepare('UPDATE docs_synced_blocks SET content = ?, updated_by = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
        .run(json, actorId, now, id, workspaceId);
      // La versión anterior también (por si no estaba: filas de antes del historial).
      const prevAt = ownedAt.get(id);
      if (prevAt) await recordSyncedHistory(workspaceId, id, prevAt, ownedJson);
      await recordSyncedHistory(workspaceId, id, now, json);
    }
    return out;
  };
  const blocks = await process(opts.next, 0);
  return { blocks, base: nextBase };
}

/** Contenido de un bloque sincronizado para pegarlo en otra página (solo del mismo workspace). */
export async function getSyncedBlock(workspaceId: string, id: string): Promise<DocsBlock[] | null> {
  if (!SYNCED_ID_RE.test(id)) return null;
  const row = (await getDb()
    .prepare('SELECT id, workspace_id, content FROM docs_synced_blocks WHERE id = ? AND workspace_id = ?')
    .get(id, workspaceId)) as SyncedRow | undefined;
  return row ? parse(row.content) : null;
}

/**
 * Antes de borrar para siempre páginas: cada sincronizado cuyo origen se va
 * pasa a tener como origen otra página activa que lo use y esté en el mismo
 * teamspace que el origen (quien podía abrir el origen puede abrirla). Si no
 * hay ninguna, el origen queda vacío y el contenido solo lo ve el dueño del
 * workspace (lib/docs-guard.ts falla cerrado).
 */
export async function reassignSyncedSources(workspaceId: string, deletedIds: string[]): Promise<void> {
  if (!deletedIds.length) return;
  const db = getDb();
  const ph = deletedIds.map(() => '?').join(',');
  const rows = (await db
    .prepare(
      `SELECT s.id, p.teamspace_id FROM docs_synced_blocks s JOIN docs_pages p ON p.id = s.source_page_id
       WHERE s.workspace_id = ? AND s.source_page_id IN (${ph})`,
    )
    .all(workspaceId, ...deletedIds)) as Array<{ id: string; teamspace_id: string | null }>;
  for (const r of rows) {
    const host = (await db
      .prepare(
        `SELECT id FROM docs_pages WHERE user_id = ? AND archived = 0 AND id NOT IN (${ph})
           AND ${r.teamspace_id ? 'teamspace_id = ?' : 'teamspace_id IS NULL'} AND content LIKE ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(workspaceId, ...deletedIds, ...(r.teamspace_id ? [r.teamspace_id] : []), `%"synced_id":"${r.id}"%`)) as { id: string } | undefined;
    await db.prepare('UPDATE docs_synced_blocks SET source_page_id = ? WHERE id = ? AND workspace_id = ?').run(host?.id ?? null, r.id, workspaceId);
  }
}


/** Última edición (updated_at más nuevo) de los sincronizados de una página: '' si no tiene. */
export async function syncedUpdatedAt(workspaceId: string, blocks: DocsBlock[]): Promise<string> {
  const ids = syncedIdsOf(blocks).filter((id) => SYNCED_ID_RE.test(id));
  if (!ids.length) return '';
  const row = (await getDb()
    .prepare(`SELECT MAX(updated_at) AS at FROM docs_synced_blocks WHERE workspace_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
    .get(workspaceId, ...ids)) as { at: string | null } | undefined;
  return row?.at ?? '';
}
