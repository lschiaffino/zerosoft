/**
 * Docs: eventos hacia Flow y los webhooks salientes (como los webhooks de la
 * API de Notion y los disparadores de sus automatizaciones).
 *
 * - page.updated: el editor guarda cada pocos segundos, así que las ediciones
 *   se agrupan (como el `page.content_updated` de Notion): cada guardado corre
 *   la marca de la página DOCS_EVENT_WINDOW_SEC hacia adelante y el cron de
 *   cada minuto emite un solo evento con el estado final cuando la página dejó
 *   de cambiar. Cada marca se reclama con compare-and-set.
 * - database.row_created y database.property_changed: al momento, uno por
 *   fila nueva y por propiedad cambiada (diff contra lo guardado).
 * - page.comment_created y page.archived: al momento.
 *
 * Solo se trabaja si hay un flow habilitado o un webhook escuchando ese
 * evento (el editor guarda mucho). Nunca tira. Server-only.
 */
import { getDb, getUserById, type DocsPageRow } from './db';
import { emitEventSoon } from './events';
import type { FlowEventType } from './flow-schema';
import type { DocsBlock, DocsDatabase } from './docs-types';
import { formatValue, normalizeDatabase, rowTitle } from './docs-database';
import { blocksToPlainText } from './docs-platform-text';

export const DOCS_EVENT_TYPES = [
  'page.created',
  'page.updated',
  'page.archived',
  'page.comment_created',
  'database.row_created',
  'database.property_changed',
] as const satisfies readonly FlowEventType[];
export type DocsEventType = (typeof DOCS_EVENT_TYPES)[number];

/** Segundos sin cambios antes de emitir page.updated. */
export function docsEventWindowSec(): number {
  const n = Number(process.env.DOCS_EVENT_WINDOW_SEC);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 3600) : 30;
}

/** ¿Hay un flow habilitado o un webhook activo para este evento? */
export async function hasDocsListeners(ws: string, type: DocsEventType): Promise<boolean> {
  try {
    const flow = await getDb()
      .prepare("SELECT 1 FROM flow_flows WHERE user_id = ? AND enabled = 1 AND trigger_type = 'trigger.event' AND trigger_event = ? LIMIT 1")
      .get(ws, type);
    if (flow) return true;
    const hook = await getDb()
      .prepare('SELECT 1 FROM webhooks WHERE user_id = ? AND active = 1 AND events LIKE ? LIMIT 1')
      .get(ws, `%"${type}"%`);
    return Boolean(hook);
  } catch {
    return false;
  }
}

function pageUrl(id: string): string {
  return `/app/docs/${id}`;
}

export function pagePayload(row: Pick<DocsPageRow, 'id' | 'title' | 'parent_id' | 'updated_at'> & { icon?: string | null }) {
  return { id: row.id, title: row.title || '', parentId: row.parent_id ?? null, url: pageUrl(row.id), updatedAt: row.updated_at };
}

async function personPayload(id: string | null | undefined) {
  if (!id) return null;
  const u = await getUserById(id).catch(() => undefined);
  return u ? { id: u.id, name: u.name ?? '', email: u.email } : { id, name: '', email: '' };
}

// ---------- page.updated agrupado ----------

/** Un guardado de título o contenido: corre la marca de la página (el cron emite). */
export async function markPageEdited(ws: string, pageId: string, actorId: string | null, now = new Date()): Promise<void> {
  try {
    if (!(await hasDocsListeners(ws, 'page.updated'))) return;
    const due = new Date(now.getTime() + docsEventWindowSec() * 1000).toISOString();
    await getDb()
      .prepare(
        `INSERT INTO docs_event_marks (page_id, workspace_id, actor_id, due_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(page_id) DO UPDATE SET due_at = excluded.due_at, actor_id = excluded.actor_id`,
      )
      .run(pageId, ws, actorId, due);
  } catch {
    /* un evento nunca corta el guardado */
  }
}

/**
 * Emite page.updated de las páginas que dejaron de cambiar (cron de cada
 * minuto). Cada marca se reclama (compare-and-set) y se borra solo si nadie
 * la volvió a correr mientras tanto.
 */
export async function flushPageUpdatedEvents(now = new Date(), limit = 50): Promise<number> {
  const iso = now.toISOString();
  const due = (await getDb()
    .prepare('SELECT page_id, due_at FROM docs_event_marks WHERE due_at <= ? AND (claimed_until IS NULL OR claimed_until < ?) ORDER BY due_at LIMIT ?')
    .all(iso, iso, limit)) as Array<{ page_id: string; due_at: string }>;
  let sent = 0;
  for (const m of due) {
    const claim = await getDb()
      .prepare('UPDATE docs_event_marks SET claimed_until = ? WHERE page_id = ? AND due_at = ? AND (claimed_until IS NULL OR claimed_until < ?)')
      .run(new Date(now.getTime() + 120_000).toISOString(), m.page_id, m.due_at, iso);
    if (claim.changes === 0) continue;
    const mark = (await getDb().prepare('SELECT * FROM docs_event_marks WHERE page_id = ?').get(m.page_id)) as
      | { workspace_id: string; actor_id: string | null; due_at: string }
      | undefined;
    const row = (await getDb().prepare('SELECT * FROM docs_pages WHERE id = ?').get(m.page_id)) as DocsPageRow | undefined;
    if (mark && row && row.archived === 0) {
      const text = blocksToPlainText(parseContent(row.content), 4000);
      await emitEventSoon(
        mark.workspace_id,
        'page.updated',
        { page: pagePayload(row), editedBy: await personPayload(mark.actor_id) },
        { extra: { text } },
      );
      sent++;
    }
    // Si se volvió a editar durante el envío, la marca tiene otro due_at y queda.
    await getDb().prepare('DELETE FROM docs_event_marks WHERE page_id = ? AND due_at = ?').run(m.page_id, m.due_at);
    await getDb().prepare('UPDATE docs_event_marks SET claimed_until = NULL WHERE page_id = ?').run(m.page_id);
  }
  return sent;
}

function parseContent(raw: string | null | undefined): DocsBlock[] {
  try {
    const v = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(v) ? (v as DocsBlock[]) : [];
  } catch {
    return [];
  }
}

// ---------- Bases ----------

function databases(blocks: DocsBlock[]): Map<string, DocsDatabase> {
  const out = new Map<string, DocsDatabase>();
  for (const b of blocks) if (b.type === 'database' && !b.linked) out.set(b.id, normalizeDatabase(b));
  return out;
}

function rowValues(db: DocsDatabase, rowId: string): Record<string, string> {
  const row = db.rows.find((r) => r.id === rowId);
  const values: Record<string, string> = {};
  if (!row) return values;
  for (const p of db.properties) if (p.type !== 'title' && p.type !== 'button') values[p.name] = formatValue(p, row);
  return values;
}

export interface DbEventDraft {
  type: 'database.row_created' | 'database.property_changed';
  data: Record<string, unknown>;
}

/** Filas nuevas y propiedades cambiadas entre dos versiones del contenido (puro). */
export function databaseEventDrafts(
  page: Pick<DocsPageRow, 'id' | 'title' | 'parent_id' | 'updated_at'>,
  before: DocsBlock[],
  after: DocsBlock[],
  max = 20,
): DbEventDraft[] {
  const prev = databases(before);
  const next = databases(after);
  const out: DbEventDraft[] = [];
  for (const [blockId, db] of next) {
    const old = prev.get(blockId);
    // Una base nueva (pegada, duplicada) no dispara una fila por cada fila que trae.
    if (!old) continue;
    const database = { blockId, title: db.title ?? '' };
    const oldRows = new Map(old.rows.map((r) => [r.id, r]));
    for (const row of db.rows) {
      const was = oldRows.get(row.id);
      const rowInfo = { id: row.id, title: rowTitle(db, row), url: `${pageUrl(page.id)}?row=${encodeURIComponent(row.id)}` };
      if (!was) {
        out.push({ type: 'database.row_created', data: { page: pagePayload(page), database, row: { ...rowInfo, properties: rowValues(db, row.id) } } });
        continue;
      }
      for (const prop of db.properties) {
        if (prop.type === 'button' || prop.type === 'formula' || prop.type === 'rollup') continue;
        const a = JSON.stringify(was.values[prop.id] ?? null);
        const b = JSON.stringify(row.values[prop.id] ?? null);
        if (a === b) continue;
        out.push({
          type: 'database.property_changed',
          data: {
            page: pagePayload(page),
            database,
            row: { ...rowInfo, properties: rowValues(db, row.id) },
            property: { id: prop.id, name: prop.name, type: prop.type },
            value: formatValue(prop, row),
            previous: formatValue(prop, was),
          },
        });
      }
      if (out.length >= max) return out.slice(0, max);
    }
  }
  return out.slice(0, max);
}

/**
 * Después de guardar una página: marca page.updated y emite los eventos de
 * sus bases. `titleOrContent` = cambió el título o el contenido.
 */
export async function afterDocsPageSaved(opts: {
  ws: string;
  before: DocsPageRow;
  after: DocsPageRow;
  actorId: string | null;
  titleOrContent: boolean;
}): Promise<void> {
  try {
    if (opts.titleOrContent) await markPageEdited(opts.ws, opts.after.id, opts.actorId);
    if (opts.before.content !== opts.after.content) {
      const rowsOn = await hasDocsListeners(opts.ws, 'database.row_created');
      const propsOn = await hasDocsListeners(opts.ws, 'database.property_changed');
      if (rowsOn || propsOn) {
        const drafts = databaseEventDrafts(opts.after, parseContent(opts.before.content), parseContent(opts.after.content));
        const by = await personPayload(opts.actorId);
        for (const d of drafts) {
          if (d.type === 'database.row_created' ? !rowsOn : !propsOn) continue;
          await emitEventSoon(opts.ws, d.type, { ...d.data, editedBy: by });
        }
      }
    }
    if (opts.before.archived === 0 && opts.after.archived === 1 && (await hasDocsListeners(opts.ws, 'page.archived'))) {
      await emitEventSoon(opts.ws, 'page.archived', { page: pagePayload(opts.after), editedBy: await personPayload(opts.actorId) });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[docs] events failed', (err as Error)?.name ?? 'error');
  }
}

/** page.created desde la API, el MCP, Flow o un agente (el editor lo emite en su ruta). */
export async function emitPageCreated(ws: string, row: Pick<DocsPageRow, 'id' | 'title' | 'parent_id' | 'updated_at'>, actorId: string | null): Promise<void> {
  await emitEventSoon(ws, 'page.created', { page: pagePayload(row), createdBy: await personPayload(actorId) });
}

export async function emitCommentCreated(
  ws: string,
  row: Pick<DocsPageRow, 'id' | 'title' | 'parent_id' | 'updated_at'>,
  comment: { id: string; body: string; block_id: string | null; parent_id?: string | null; user_id: string },
): Promise<void> {
  if (!(await hasDocsListeners(ws, 'page.comment_created'))) return;
  await emitEventSoon(ws, 'page.comment_created', {
    page: pagePayload(row),
    comment: {
      id: comment.id,
      text: comment.body.replace(/<[^>]+>/g, '').slice(0, 4000),
      blockId: comment.block_id,
      parentId: comment.parent_id ?? null,
    },
    author: await personPayload(comment.user_id),
  });
}
