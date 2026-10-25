import { getDb } from './db';
import { blockIndent, setIndent, subtreeEnd } from './docs-blocks';
import { sanitizeBlocks } from './docs-sanitize';
import type { DocsBlock } from './docs-types';

/**
 * Bloques sincronizados de Docs (como los de Notion): un bloque `synced` con
 * `synced_id` y sus hijos en la lista plana. El contenido vive en
 * docs_synced_blocks (por workspace): al guardar una página, lo que la persona
 * editó adentro de un bloque sincronizado se escribe ahí; al abrir cualquier
 * página que lo usa, sus hijos se reemplazan por esa copia. La página guarda
 * su propia copia (búsqueda, versiones y export la ven sin leer otra tabla).
 */

export const SYNCED_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_SYNCED_BLOCKS = 500;

interface SyncedRow {
  id: string;
  workspace_id: string;
  content: string;
}

function childrenOf(blocks: DocsBlock[], i: number): DocsBlock[] {
  const end = subtreeEnd(blocks, i);
  const base = blockIndent(blocks[i]) + 1;
  return blocks.slice(i + 1, end + 1).map((b) => setIndent(b, blockIndent(b) - base));
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

/**
 * Reemplaza los hijos de cada bloque sincronizado por el contenido actual
 * (al leer una página). Los que no existen en el workspace quedan como están.
 * Con `canRead`: si quien mira no puede abrir la página de origen, el bloque
 * queda sin hijos y con `no_access` (como Notion: "no tenés acceso").
 */
export async function hydrateSyncedBlocks(workspaceId: string, blocks: DocsBlock[], canRead?: SyncedReader): Promise<DocsBlock[]> {
  const ids = blocks.filter((b) => b.type === 'synced' && b.synced_id).map((b) => b.synced_id!);
  if (!ids.length) return blocks;
  const denied = canRead ? await unreadableSyncedIds(workspaceId, blocks, canRead) : new Set<string>();
  const contents = await getSyncedContents(workspaceId, ids).catch(() => new Map<string, DocsBlock[]>());
  if (!contents.size && !denied.size) return blocks;
  const out: DocsBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'synced' && b.synced_id && denied.has(b.synced_id)) {
      out.push({ ...b, no_access: true });
      i = subtreeEnd(blocks, i);
      continue;
    }
    out.push(b);
    const content = b.type === 'synced' && b.synced_id ? contents.get(b.synced_id) : undefined;
    if (!content) continue;
    const end = subtreeEnd(blocks, i);
    const base = blockIndent(b) + 1;
    out.push(...content.map((c) => setIndent(c, blockIndent(c) + base)));
    i = end;
  }
  return out;
}

/**
 * Al guardar una página: escribe en docs_synced_blocks lo que cambió adentro
 * de cada bloque sincronizado respecto de lo que la página tenía guardado
 * (así una página abierta con una copia vieja no pisa lo que otra editó).
 * Un id que no es del workspace (pegado de otro lado) se suelta: el bloque
 * queda como un contenedor propio con id nuevo.
 */
export async function persistSyncedBlocks(opts: {
  workspaceId: string;
  pageId: string;
  actorId: string | null;
  previous: DocsBlock[];
  next: DocsBlock[];
  /**
   * Sincronizados que quien guarda no puede ver (le llegaron sin hijos): su
   * contenido no se toca; en la página queda la copia que ya tenía.
   */
  locked?: Set<string>;
}): Promise<DocsBlock[]> {
  const { workspaceId, pageId, actorId, previous } = opts;
  const locked = opts.locked ?? new Set<string>();
  const next = locked.size ? restoreLocked(previous, opts.next, locked) : opts.next;
  const indexes = next.map((b, i) => (b.type === 'synced' ? i : -1)).filter((i) => i !== -1);
  if (!indexes.length) return next;
  const before = new Map<string, string>();
  previous.forEach((b, i) => {
    if (b.type === 'synced' && b.synced_id) before.set(b.synced_id, JSON.stringify(childrenOf(previous, i)));
  });
  const ids = indexes.map((i) => next[i].synced_id).filter((id): id is string => !!id);
  const owned = await getSyncedContents(workspaceId, ids);
  const foreign = new Set<string>();
  if (ids.length) {
    const rows = (await getDb()
      .prepare(`SELECT id FROM docs_synced_blocks WHERE workspace_id != ? AND id IN (${[...new Set(ids)].map(() => '?').join(',')})`)
      .all(workspaceId, ...new Set(ids))) as Array<{ id: string }>;
    for (const r of rows) foreign.add(r.id);
  }
  const now = new Date().toISOString();
  let out = next;
  const written = new Set<string>();
  for (const i of indexes) {
    const b = out[i];
    // Uno sin acceso que no estaba en la página (pegado sabiendo el id): bloque propio nuevo.
    const lockedNew = !!b.synced_id && locked.has(b.synced_id) && !before.has(b.synced_id);
    let id = b.synced_id && SYNCED_ID_RE.test(b.synced_id) && !foreign.has(b.synced_id) && !lockedNew ? b.synced_id : null;
    if (!id) {
      id = crypto.randomUUID();
      out = out.map((x, k) => (k === i ? { ...x, synced_id: id! } : x));
    }
    if (written.has(id) || locked.has(id)) continue;
    written.add(id);
    const children = sanitizeBlocks(childrenOf(out, i).filter((c) => c.type !== 'database')).slice(0, MAX_SYNCED_BLOCKS);
    const json = JSON.stringify(children);
    if (!owned.has(id)) {
      await getDb()
        .prepare(
          `INSERT INTO docs_synced_blocks (id, workspace_id, source_page_id, content, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        )
        .run(id, workspaceId, pageId, json, actorId, now, now);
      continue;
    }
    // Solo si cambió en esta página (no si es la copia que ya traía).
    if (before.get(id) === json) continue;
    if (JSON.stringify(owned.get(id)) === json) continue;
    await getDb()
      .prepare('UPDATE docs_synced_blocks SET content = ?, updated_by = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
      .run(json, actorId, now, id, workspaceId);
  }
  return out;
}

/**
 * Sincronizados sin acceso: cada uno vuelve a ser el que estaba guardado en
 * la página (con su copia de los hijos), en el lugar y la sangría nuevos.
 */
function restoreLocked(previous: DocsBlock[], next: DocsBlock[], locked: Set<string>): DocsBlock[] {
  const out: DocsBlock[] = [];
  for (let i = 0; i < next.length; i++) {
    const b = next[i];
    const { no_access: _n, ...clean } = b;
    void _n;
    if (b.type !== 'synced' || !b.synced_id || !locked.has(b.synced_id)) {
      out.push(b.no_access ? clean : b);
      continue;
    }
    const j = previous.findIndex((x) => x.type === 'synced' && x.synced_id === b.synced_id);
    const end = subtreeEnd(next, i);
    if (j === -1) {
      out.push(clean);
      i = end;
      continue;
    }
    const prevEnd = subtreeEnd(previous, j);
    const shift = blockIndent(b) - blockIndent(previous[j]);
    out.push({ ...setIndent(previous[j], blockIndent(b)), id: b.id });
    for (const c of previous.slice(j + 1, prevEnd + 1)) out.push(setIndent(c, blockIndent(c) + shift));
    i = end;
  }
  return out;
}

/** Contenido de un bloque sincronizado para pegarlo en otra página (solo del mismo workspace). */
export async function getSyncedBlock(workspaceId: string, id: string): Promise<DocsBlock[] | null> {
  if (!SYNCED_ID_RE.test(id)) return null;
  const row = (await getDb()
    .prepare('SELECT id, workspace_id, content FROM docs_synced_blocks WHERE id = ? AND workspace_id = ?')
    .get(id, workspaceId)) as SyncedRow | undefined;
  return row ? parse(row.content) : null;
}
