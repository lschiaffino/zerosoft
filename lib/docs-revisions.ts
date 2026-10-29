/**
 * Últimas versiones guardadas de una página (docs_page_revisions): la base
 * de la fusión de tres vías cuando un editor guarda sobre una versión vieja
 * (ver lib/docs-merge.ts). Se guardan las de los últimos 10 minutos (al
 * menos 30, a lo sumo 300 por página). Las tandas de teclas de la edición
 * simultánea no dejan una cada una: la versión de cualquier momento se arma
 * con la última guardada antes y las operaciones del feed (lib/docs-coedit.ts).
 */
import { getDb, type DocsPageRow } from './db';
import { apply, isTextOp, textHash } from './docs-ot';

export interface DocsRevision {
  updated_at: string;
  title: string;
  icon: string | null;
  cover_url: string | null;
  content: string;
}

const KEEP_MIN = 30;
const KEEP_MAX = 300;
const KEEP_WINDOW_MS = 10 * 60_000;

/**
 * `updated_at` nuevo para un guardado sobre `prev`: la hora actual, pero
 * siempre posterior a `prev`. Es el token de versión de la página (bases del
 * editor, fusión, revisiones): dos guardados en el mismo milisegundo no pueden
 * quedar con el mismo valor, si no el segundo no ve el cambio del primero.
 */
export function nextUpdatedAt(prev: string | null | undefined, now = new Date()): string {
  const before = prev ? Date.parse(prev) : NaN;
  return new Date(Number.isFinite(before) && before >= now.getTime() ? before + 1 : now.getTime()).toISOString();
}

export async function getRevision(pageId: string, updatedAt: string): Promise<DocsRevision | null> {
  const exact = ((await getDb()
    .prepare('SELECT updated_at, title, icon, cover_url, content FROM docs_page_revisions WHERE page_id = ? AND updated_at = ?')
    .get(pageId, updatedAt)) as DocsRevision | undefined) ?? null;
  return exact ?? (await revisionFromOps(pageId, updatedAt));
}

/**
 * La página como estaba en `at` cuando esa marca la dejó una tanda de teclas
 * (no guarda versión): la última versión guardada antes, más las operaciones
 * que entraron hasta `at`, en orden. Null si no se puede armar exacta.
 */
async function revisionFromOps(pageId: string, at: string): Promise<DocsRevision | null> {
  const base = await getRevisionAtOrBefore(pageId, at);
  if (!base) return null;
  let rows: Array<{ block_id: string; payload: string; at: string }>;
  try {
    rows = (await getDb()
      .prepare(
        `SELECT block_id, payload, json_extract(payload, '$.at') AS at FROM docs_live_events
         WHERE page_id = ? AND kind = 'op' AND json_extract(payload, '$.at') > ? AND json_extract(payload, '$.at') <= ? ORDER BY id`,
      )
      .all(pageId, base.updated_at, at)) as Array<{ block_id: string; payload: string; at: string }>;
  } catch {
    return null;
  }
  // La marca tiene que ser de una tanda de teclas (si no, no es una versión que existió).
  if (!rows.some((r) => r.at === at)) return null;
  let blocks: Array<{ id: string; content?: unknown }>;
  try {
    blocks = JSON.parse(base.content) as Array<{ id: string; content?: unknown }>;
  } catch {
    return null;
  }
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  for (const r of rows) {
    const i = index.get(r.block_id);
    if (i === undefined) return null;
    let p: { op?: unknown; hb?: string; ha?: string };
    try {
      p = JSON.parse(r.payload) as { op?: unknown; hb?: string; ha?: string };
    } catch {
      return null;
    }
    const text = typeof blocks[i].content === 'string' ? (blocks[i].content as string) : null;
    // Ya está en la versión guardada (la reconciliación de un cambio que entró por el guardado).
    if (text !== null && p.ha && textHash(text) === p.ha) continue;
    if (text === null || !isTextOp(p.op) || (p.hb && textHash(text) !== p.hb)) return null;
    try {
      blocks[i] = { ...blocks[i], content: apply(text, p.op) };
    } catch {
      return null;
    }
  }
  return { ...base, updated_at: at, content: JSON.stringify(blocks) };
}

/**
 * La última versión guardada en o antes de `at`. Con la edición simultánea
 * alcanza para la estructura (qué bloques hay y en qué orden): el texto de
 * los bloques no lo toma de acá (ver lib/docs-coedit-shared.ts).
 */
export async function getRevisionAtOrBefore(pageId: string, at: string): Promise<DocsRevision | null> {
  return (
    ((await getDb()
      .prepare('SELECT updated_at, title, icon, cover_url, content FROM docs_page_revisions WHERE page_id = ? AND updated_at <= ? ORDER BY updated_at DESC LIMIT 1')
      .get(pageId, at)) as DocsRevision | undefined) ?? null
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
  const insert = 'INSERT OR IGNORE INTO docs_page_revisions (page_id, updated_at, title, icon, cover_url, content) VALUES (?, ?, ?, ?, ?, ?)';
  const had = await db.prepare('SELECT 1 FROM docs_page_revisions WHERE page_id = ? AND updated_at = ?').get(prev.id, prev.updated_at);
  if (!had) await db.prepare(insert).run(prev.id, prev.updated_at, prev.title ?? '', prev.icon ?? null, prev.cover_url ?? null, prev.content ?? '[]');
  // La nueva manda (si cae en el mismo milisegundo que la anterior, la reemplaza).
  await db.prepare(insert.replace('INSERT OR IGNORE', 'INSERT OR REPLACE')).run(prev.id, next.updated_at, next.title ?? '', next.icon ?? null, next.cover_url ?? null, next.content);
  // Las de los últimos 10 minutos (al menos KEEP_MIN, nunca más de KEEP_MAX): un editor o la API
  // que guardan sobre una versión de hace unos minutos todavía se fusionan.
  const cutoff = new Date(Date.parse(next.updated_at) - KEEP_WINDOW_MS).toISOString();
  await db
    .prepare(
      `DELETE FROM docs_page_revisions WHERE page_id = ? AND updated_at NOT IN (
         SELECT updated_at FROM docs_page_revisions WHERE page_id = ? ORDER BY updated_at DESC LIMIT ${KEEP_MIN})
       AND (updated_at < ? OR updated_at NOT IN (
         SELECT updated_at FROM docs_page_revisions WHERE page_id = ? ORDER BY updated_at DESC LIMIT ${KEEP_MAX}))`,
    )
    .run(prev.id, prev.id, cutoff, prev.id);
}
