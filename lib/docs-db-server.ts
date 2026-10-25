/**
 * Bases de Docs del lado del servidor: leer la base de otra página (para
 * relaciones, rollups y vistas vinculadas), aplicarle operaciones con los
 * permisos de esa página, listar las bases del workspace (selector de
 * relación y de vista vinculada) y correr las acciones de afuera de botones
 * y automatizaciones (notificar, webhook, agregar fila en otra base), con un
 * registro de cada corrida.
 */
import { getDb, getUserById, type DocsPageRow } from './db';
import { getDocAccess, listPageMentionables, parseBlocks, type DocsActor } from './docs';
import type { DbAction, DbProperty, DbRow, DbValue, DocsAccess, DocsBlock, DocsDatabase } from './docs-types';
import { canWriteAccess } from './docs-access';
import { stringifyBlocks } from './docs-types';
import { cellValue, formatValue, normalizeDatabase, rowTitle } from './docs-database';
import { actionIncomplete, applyDbOps, fillTemplate, type DbOp } from './docs-db-ops';
import { prepareDatabaseSave, type DbEffect } from './docs-db-save';
import { sanitizeBlocks } from './docs-sanitize';
import { stripFileUrls } from './docs-files';
import { safeFetch } from './safe-fetch';
import { createNotification } from './notifications';
import { recordRevisions } from './docs-revisions';

export class DbServerError extends Error {
  constructor(
    public code: 'not_found' | 'forbidden' | 'conflict' | 'invalid_input' | 'locked',
    public status: number,
  ) {
    super(code);
  }
}

export interface LoadedDatabase {
  page: DocsPageRow;
  access: DocsAccess;
  blocks: DocsBlock[];
  index: number;
  db: DocsDatabase;
}

async function pageRow(pageId: string): Promise<DocsPageRow | null> {
  return ((await getDb().prepare('SELECT * FROM docs_pages WHERE id = ?').get(pageId)) as DocsPageRow | undefined) ?? null;
}

/** Base de un bloque de una página que el actor puede ver (o editar, con `edit`). */
export async function loadDatabase(actor: DocsActor, pageId: string, blockId: string, opts: { edit?: boolean } = {}): Promise<LoadedDatabase> {
  const page = await pageRow(pageId);
  const access = page ? await getDocAccess(page, actor) : null;
  if (!page || !access || page.archived === 1) throw new DbServerError('not_found', 404);
  // Ver o comentar no alcanza para cambiar filas.
  if (opts.edit && !canWriteAccess(access)) throw new DbServerError('forbidden', 403);
  const blocks = parseBlocks(page.content);
  const index = blocks.findIndex((b) => b.id === blockId && b.type === 'database' && !b.linked);
  if (index === -1) throw new DbServerError('not_found', 404);
  return { page, access, blocks, index, db: normalizeDatabase(blocks[index]) };
}

/** La base tal como viaja a otra página: sin cuerpos de fila (pesan) y sin URLs de archivo para quien solo ve. */
export function databaseForClient(loaded: LoadedDatabase): DocsDatabase {
  const rows: DbRow[] = loaded.db.rows.map((r) => {
    const { body: _body, ...rest } = r;
    void _body;
    if (loaded.access !== 'view' || !rest.files) return rest;
    const files = Object.fromEntries(Object.entries(rest.files).map(([k, list]) => [k, list.map((f) => ({ ...f, url: '' }))]));
    return { ...rest, files };
  });
  return { ...loaded.db, rows };
}

/** Cuerpo de una fila (al abrirla desde otra página no hace falta: se abre en su página). */
export function rowBodyForClient(loaded: LoadedDatabase, rowId: string): DocsBlock[] {
  const body = loaded.db.rows.find((r) => r.id === rowId)?.body ?? [];
  return loaded.access === 'view' ? stripFileUrls(body) : body;
}

/**
 * Aplica operaciones a la base de otra página y guarda. Compare-and-set sobre
 * updated_at (reintenta si otro guardado se coló), así dos operaciones a la
 * vez no se pisan. Corre las automatizaciones de esa base (filas nuevas,
 * propiedades cambiadas) y devuelve sus efectos de afuera.
 */
export async function applyRemoteOps(
  actor: DocsActor & { realId?: string },
  pageId: string,
  blockId: string,
  ops: DbOp[],
  opts: { respectLock?: boolean } = {},
): Promise<{ db: DocsDatabase; effects: DbEffect[]; updated_at: string }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const loaded = await loadDatabase(actor, pageId, blockId, { edit: true });
    // Página bloqueada: nadie la edita desde la API de bases (igual que el PATCH de la página).
    if (opts.respectLock && loaded.page.locked === 1) throw new DbServerError('locked', 423);
    const now = new Date().toISOString();
    const next = applyDbOps(loaded.db, ops, now);
    const blocks = loaded.blocks.map((b, i) => (i === loaded.index ? { ...b, db: next, columns: undefined, rows: undefined, view: undefined } : b));
    const sanitized = sanitizeBlocks(blocks);
    const saved = prepareDatabaseSave(pageId, loaded.blocks, sanitized, actor.realId ?? actor.actingUser?.id ?? actor.id, now);
    const res = await getDb()
      .prepare('UPDATE docs_pages SET content = ?, updated_at = ? WHERE id = ? AND updated_at = ?')
      .run(stringifyBlocks(saved.blocks), now, pageId, loaded.page.updated_at);
    if (res.changes === 0) continue;
    await recordRevisions(loaded.page, { updated_at: now, title: loaded.page.title, icon: loaded.page.icon, cover_url: loaded.page.cover_url, content: stringifyBlocks(saved.blocks) }).catch(() => undefined);
    const block = saved.blocks.find((b) => b.id === blockId)!;
    return { db: normalizeDatabase(block), effects: saved.effects, updated_at: now };
  }
  throw new DbServerError('conflict', 409);
}

export interface DatabaseListItem {
  page_id: string;
  page_title: string;
  page_icon: string | null;
  block_id: string;
  title: string;
  properties: Array<Pick<DbProperty, 'id' | 'name' | 'type'>>;
}

/** Bases del workspace (páginas no archivadas), para el selector de relación y de vista vinculada. */
export async function listWorkspaceDatabases(ownerId: string, q = '', limit = 50): Promise<DatabaseListItem[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT id, title, icon, content FROM docs_pages
       WHERE user_id = ? AND archived = 0 AND content LIKE '%"type":"database"%'
       ORDER BY updated_at DESC LIMIT 400`,
    )
    .all(ownerId)) as Array<Pick<DocsPageRow, 'id' | 'title' | 'icon' | 'content'>>;
  const needle = q.trim().toLowerCase();
  const out: DatabaseListItem[] = [];
  for (const r of rows) {
    for (const b of parseBlocks(r.content)) {
      if (b.type !== 'database' || b.linked) continue;
      const db = normalizeDatabase(b);
      const title = db.title ?? '';
      if (needle && !`${title} ${r.title}`.toLowerCase().includes(needle)) continue;
      out.push({
        page_id: r.id,
        page_title: r.title,
        page_icon: r.icon ?? null,
        block_id: b.id,
        title,
        properties: db.properties.map((p) => ({ id: p.id, name: p.name, type: p.type })),
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// ---------- Acciones de afuera ----------

async function logRun(e: { pageId: string; blockId: string; automationId: string; rowId: string; action: string; ok: boolean; detail?: string }) {
  const db = getDb();
  await db
    .prepare(
      `INSERT INTO docs_db_automation_runs (id, page_id, block_id, automation_id, row_id, action_type, status, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(crypto.randomUUID(), e.pageId, e.blockId, e.automationId, e.rowId, e.action, e.ok ? 'ok' : 'error', (e.detail ?? '').slice(0, 500), new Date().toISOString());
  // Se guardan las últimas 200 corridas por base.
  await db
    .prepare(
      `DELETE FROM docs_db_automation_runs WHERE page_id = ? AND block_id = ? AND id NOT IN (
         SELECT id FROM docs_db_automation_runs WHERE page_id = ? AND block_id = ? ORDER BY created_at DESC LIMIT 200)`,
    )
    .run(e.pageId, e.blockId, e.pageId, e.blockId);
}

export interface AutomationRun {
  id: string;
  automation_id: string;
  row_id: string;
  action_type: string;
  status: 'ok' | 'error';
  detail: string;
  created_at: string;
}

export async function listAutomationRuns(pageId: string, blockId: string, limit = 50): Promise<AutomationRun[]> {
  return (await getDb()
    .prepare(
      `SELECT id, automation_id, row_id, action_type, status, detail, created_at FROM docs_db_automation_runs
       WHERE page_id = ? AND block_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(pageId, blockId, limit)) as AutomationRun[];
}

export interface RunContext {
  /** Quién disparó (persona real): se usa como autor y para los permisos de la otra base. */
  actor: DocsActor & { realId?: string };
  page: Pick<DocsPageRow, 'id' | 'user_id' | 'title'>;
  blockId: string;
  db: DocsDatabase;
  rowId: string;
  /** Fila como la ve el editor (un botón en una fila sin guardar todavía). */
  rowSnapshot?: { title: string; values: Record<string, string> };
  /** Nombre en el registro: id de la automatización o `button:<propiedad>`. */
  source: string;
  sourceName?: string;
  /** Acciones que ya se hicieron en el guardado (id → detalle): solo se registran. */
  done?: Record<string, string>;
}

function rowText(ctx: RunContext): { title: string; values: Record<string, string>; row?: DbRow } {
  const row = ctx.db.rows.find((r) => r.id === ctx.rowId);
  if (row) {
    const values: Record<string, string> = {};
    for (const p of ctx.db.properties) if (p.type !== 'title' && p.type !== 'button') values[p.name] = formatValue(p, row);
    return { title: rowTitle(ctx.db, row), values, row };
  }
  return { title: ctx.rowSnapshot?.title ?? '', values: ctx.rowSnapshot?.values ?? {} };
}

/** Corre una acción de afuera; tira con un mensaje corto si falla. */
async function runAction(action: DbAction, ctx: RunContext): Promise<string> {
  // A medio armar: se saltea y queda en el registro como no hecha.
  if (actionIncomplete(action)) throw new Error('incomplete');
  const text = rowText(ctx);
  const format = (p: DbProperty, r: DbRow) => formatValue(p, r);
  const href = `/app/docs/${ctx.page.id}?row=${encodeURIComponent(ctx.rowId)}`;
  switch (action.type) {
    case 'notify': {
      const allowed = new Map((await listPageMentionables(ctx.page)).map((m) => [m.id, m]));
      const ids = new Set<string>((action.people ?? []).filter((id) => allowed.has(id)));
      if (action.person_prop && text.row) {
        const prop = ctx.db.properties.find((p) => p.id === action.person_prop);
        const v = prop ? cellValue(prop, text.row) : null;
        for (const id of Array.isArray(v) ? v : []) if (allowed.has(id)) ids.add(id);
      }
      if (!ids.size) throw new Error('no_recipients');
      const actorUser = await getUserById(ctx.actor.realId ?? ctx.actor.actingUser?.id ?? ctx.actor.id);
      const fallback = `${ctx.db.title || ctx.page.title || 'Database'}: ${text.title || 'Untitled'}`;
      const message = action.message ? fillTemplate(action.message, ctx.db, text.row, format) : '';
      for (const id of [...ids].slice(0, 20)) {
        await createNotification({
          userId: id,
          type: 'db_automation',
          title: message || fallback,
          body: message ? fallback : undefined,
          href,
          sourceType: 'docs_database',
          sourceId: `${ctx.page.id}:${ctx.blockId}`,
          meta: { pageId: ctx.page.id, rowId: ctx.rowId, actorName: actorUser?.name ?? actorUser?.email ?? '', source: ctx.sourceName ?? '' },
        });
      }
      return `notified:${ids.size}`;
    }
    case 'webhook': {
      const payload = {
        event: ctx.source.startsWith('button:') ? 'database.button' : 'database.automation',
        source: ctx.sourceName ?? ctx.source,
        page: { id: ctx.page.id, title: ctx.page.title },
        database: { block_id: ctx.blockId, title: ctx.db.title ?? '' },
        row: { id: ctx.rowId, title: text.title, properties: text.values },
        sent_at: new Date().toISOString(),
      };
      const res = await safeFetch(action.url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'zerosoft-docs' }, body: JSON.stringify(payload) }, 8000);
      await res.body?.cancel().catch(() => {});
      if (!res.ok) throw new Error(`http_${res.status}`);
      return `http_${res.status}`;
    }
    case 'add_row': {
      const title = action.title ? fillTemplate(action.title, ctx.db, text.row, format) : '';
      const values: Record<string, DbValue> = {};
      for (const [k, v] of Object.entries(action.values ?? {})) values[k] = typeof v === 'string' ? fillTemplate(v, ctx.db, text.row, format) : v;
      const res = await applyRemoteOps(ctx.actor, action.target.page_id, action.target.block_id, [{ op: 'add_row', values, title }]);
      return `row:${res.db.rows[res.db.rows.length - 1]?.id ?? ''}`;
    }
    default:
      return 'skipped';
  }
}

/** Corre las acciones de afuera y deja registro de cada una. Nunca tira: los errores quedan en el registro. */
export async function runRemoteActions(actions: DbAction[], ctx: RunContext): Promise<Array<{ action: string; ok: boolean; detail: string }>> {
  const out: Array<{ action: string; ok: boolean; detail: string }> = [];
  for (const a of actions) {
    let ok = true;
    let detail = '';
    try {
      detail = ctx.done?.[a.id] ?? (await runAction(a, ctx));
    } catch (err) {
      ok = false;
      detail = err instanceof DbServerError ? err.code : err instanceof Error ? err.message.slice(0, 200) : 'error';
    }
    out.push({ action: a.type, ok, detail });
    await logRun({ pageId: ctx.page.id, blockId: ctx.blockId, automationId: ctx.source, rowId: ctx.rowId, action: a.type, ok, detail }).catch(() => {});
  }
  return out;
}

/** Efectos de automatizaciones de un guardado (se llama con `after()`, después de responder). */
export async function runDbEffects(effects: DbEffect[], actor: DocsActor & { realId?: string }): Promise<void> {
  if (!effects.length) return;
  const byPage = new Map<string, DocsPageRow | null>();
  for (const e of effects.slice(0, 50)) {
    if (!byPage.has(e.pageId)) byPage.set(e.pageId, await pageRow(e.pageId));
    const page = byPage.get(e.pageId);
    if (!page) continue;
    const block = parseBlocks(page.content).find((b) => b.id === e.blockId && b.type === 'database');
    if (!block) continue;
    await runRemoteActions(e.actions, {
      actor,
      page,
      blockId: e.blockId,
      db: normalizeDatabase(block),
      rowId: e.rowId,
      source: e.automationId,
      sourceName: e.automationName,
      done: e.done,
    });
  }
}

