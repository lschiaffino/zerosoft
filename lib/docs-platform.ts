/**
 * Docs como plataforma (tanda D4): las operaciones que comparten la API REST
 * pública (/api/v1/docs), el servidor MCP de Docs, los nodos de Flow y las
 * herramientas de Agents. Como la API de Notion: páginas (con su contenido en
 * Markdown o bloques), bloques, bases (esquema y filas), búsqueda y
 * comentarios.
 *
 * Permisos: todo pasa por lib/docs-platform-access.ts (acceso de la persona a
 * cada página, teamspaces ocultos). Escribir exige editar la página. Las
 * bases sincronizadas no se escriben. Server-only.
 */
import { getDb, type DocsPageRow } from './db';
import {
  DocsConflictError,
  cleanContent,
  createDocComment,
  createDocPage,
  listDocComments,
  listPageMentionables,
  parseBlocks,
  searchDocPagesContent,
  updateDocPage,
  type DocsActor,
} from './docs';
import type { DbOption, DbProperty, DbRow, DbValue, DocsBlock, DocsDatabase } from './docs-types';
import { stringifyBlocks } from './docs-types';
import {
  cellValue,
  formatValue,
  isComputedType,
  newDbId,
  normalizeDatabase,
  parseCheckbox,
  parseDateText,
  parseNumber,
  rowTitle,
  titleProperty,
} from './docs-database';
import { applyRemoteOps, DbServerError, loadDatabase, runDbEffects } from './docs-db-server';
import type { DbOp } from './docs-db-ops';
import { actorPersonId, pageFor, readablePageRows, visibleBlocksFor, type PlatformAudience } from './docs-platform-access';
import { blocksToMd, blocksToPlainText, mdToBlocks } from './docs-platform-text';
import { emitCommentCreated, emitPageCreated } from './docs-events';

export class DocsPlatformError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
    this.name = 'DocsPlatformError';
  }
}

const notFound = () => new DocsPlatformError('not_found', 404);

/**
 * Página para escribir, con las mismas reglas que el editor: ver o comentar
 * no alcanza (403) y una página bloqueada no cambia su contenido (423).
 */
async function pageForWrite(actor: DocsActor, pageId: string, opts: { includeArchived?: boolean; content?: boolean } = {}) {
  const res = await pageFor(actor, pageId, { includeArchived: opts.includeArchived });
  if (!res) throw notFound();
  const { canWriteAccess } = await import('./docs-access');
  if (!canWriteAccess(res.access)) throw new DocsPlatformError('forbidden', 403);
  if (opts.content !== false && res.row.locked === 1) throw new DocsPlatformError('locked', 423);
  return res;
}

// ---------- Salidas ----------

export interface PageSummaryOut {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface PageOut extends PageSummaryOut {
  access: 'owner' | 'full' | 'edit' | 'comment' | 'view';
  markdown: string;
  blocks?: DocsBlock[];
  databases: Array<{ blockId: string; title: string; rows: number; synced: boolean }>;
}

export function pageSummary(r: Pick<DocsPageRow, 'id' | 'title' | 'icon' | 'parent_id' | 'created_at' | 'updated_at' | 'archived'>): PageSummaryOut {
  return {
    id: r.id,
    title: r.title || '',
    icon: r.icon ?? null,
    parentId: r.parent_id ?? null,
    url: `/app/docs/${r.id}`,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archived: r.archived === 1,
  };
}

function databasesOf(blocks: DocsBlock[]): PageOut['databases'] {
  return blocks
    .filter((b) => b.type === 'database' && !b.linked)
    .map((b) => {
      const db = normalizeDatabase(b);
      return { blockId: b.id, title: db.title ?? '', rows: db.rows.length, synced: Boolean(db.sync) };
    });
}

// ---------- Páginas ----------

export async function listPages(
  actor: DocsActor,
  opts: { parentId?: string | null; q?: string; limit?: number; offset?: number } = {},
): Promise<{ pages: PageSummaryOut[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  if (opts.q?.trim()) {
    const hits = await searchPages(actor, opts.q, limit + offset + 1);
    const pages = hits.slice(offset, offset + limit).map((h) => h.page);
    return { pages, hasMore: hits.length > offset + limit };
  }
  let rows = await readablePageRows(actor, { withContent: false, limit: 2000 });
  if (opts.parentId !== undefined) rows = rows.filter((r) => (r.parent_id ?? null) === opts.parentId);
  return { pages: rows.slice(offset, offset + limit).map(pageSummary), hasMore: rows.length > offset + limit };
}

export interface SearchHitOut {
  page: PageSummaryOut;
  /** Fila de una base cuyo título coincide (se abre con ?row=). */
  rowId?: string;
  rowTitle?: string;
  snippet: string | null;
}

/** Búsqueda de páginas y filas por título y contenido (las que la persona puede leer). */
export async function searchPages(actor: DocsActor, q: string, limit = 20): Promise<SearchHitOut[]> {
  const query = q.trim().slice(0, 200);
  if (!query) return [];
  const hits = await searchDocPagesContent(actor.id, query, Math.min(limit * 2, 100));
  const out: SearchHitOut[] = [];
  const seen = new Map<string, Awaited<ReturnType<typeof pageFor>>>();
  for (const h of hits) {
    if (!seen.has(h.id)) seen.set(h.id, await pageFor(actor, h.id));
    const res = seen.get(h.id);
    if (!res) continue;
    out.push({
      page: pageSummary(res.row),
      ...(h.row_id ? { rowId: h.row_id, rowTitle: h.title } : {}),
      snippet: h.snippet ?? null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function getPage(
  actor: DocsActor,
  pageId: string,
  opts: { blocks?: boolean; includeArchived?: boolean; audience?: PlatformAudience } = {},
): Promise<PageOut> {
  const res = await pageFor(actor, pageId, { includeArchived: opts.includeArchived });
  if (!res) throw notFound();
  const blocks = await visibleBlocksFor(res.row, res.row.content, opts.audience ?? { actor });
  return {
    ...pageSummary(res.row),
    access: res.access,
    markdown: blocksToMd(blocks),
    ...(opts.blocks ? { blocks } : {}),
    databases: databasesOf(blocks),
  };
}

/** Texto plano de una página (para la IA y los agentes). */
export async function pageText(actor: DocsActor, pageId: string, maxChars = 20_000): Promise<{ page: PageSummaryOut; text: string } | null> {
  const res = await pageFor(actor, pageId);
  if (!res) return null;
  return { page: pageSummary(res.row), text: blocksToPlainText(await visibleBlocksFor(res.row, res.row.content, { actor }), maxChars) };
}

export interface CreatePageInput {
  title?: string;
  parentId?: string | null;
  icon?: string | null;
  markdown?: string;
  blocks?: DocsBlock[];
  /** Plantilla del workspace (docs_templates) o integrada (`builtin:<key>`). */
  templateId?: string | null;
  /** Valores para {{variables}} del contenido de la plantilla. */
  vars?: Record<string, string>;
  locale?: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** {{nombre}} en el contenido de una plantilla → valor (escapado: el contenido es HTML-lite). */
export function fillTemplateBlocks(blocks: DocsBlock[], vars: Record<string, string>): DocsBlock[] {
  const keys = Object.keys(vars);
  if (!keys.length) return blocks;
  const fill = (s: string) => s.replace(/\{\{\s*([\w.-]{1,60})\s*\}\}/g, (m, k: string) => (k in vars ? escapeHtml(vars[k]) : m));
  return blocks.map((b) => (typeof b.content === 'string' && b.content.includes('{{') ? { ...b, content: fill(b.content) } : b));
}

async function templateBlocks(ws: string, templateId: string, locale = 'en'): Promise<{ title: string; icon: string | null; blocks: DocsBlock[] } | null> {
  if (templateId.startsWith('builtin:')) {
    const { getDocTemplate } = await import('./docs-templates');
    const tpl = getDocTemplate(locale, templateId.slice(8));
    return tpl ? { title: tpl.title, icon: tpl.icon, blocks: tpl.makeBlocks() } : null;
  }
  const row = (await getDb().prepare('SELECT title, icon, content FROM docs_templates WHERE id = ? AND workspace_id = ?').get(templateId, ws)) as
    | { title: string; icon: string | null; content: string }
    | undefined;
  if (!row) return null;
  return { title: row.title, icon: row.icon, blocks: parseBlocks(row.content).map((b) => ({ ...b, id: crypto.randomUUID() })) };
}

export async function createPage(actor: DocsActor, input: CreatePageInput): Promise<PageOut> {
  let parentId: string | null = null;
  if (input.parentId) {
    const parent = await pageFor(actor, input.parentId, { write: true });
    if (!parent) throw new DocsPlatformError('parent_not_found', 404);
    if (parent.row.locked === 1) throw new DocsPlatformError('locked', 423);
    // Las subpáginas viven en el workspace del padre.
    if (parent.row.user_id !== actor.id) throw new DocsPlatformError('parent_not_found', 404);
    parentId = parent.row.id;
  }
  let content: DocsBlock[] | undefined;
  let title = (input.title ?? '').trim().slice(0, 300);
  let icon = input.icon ?? null;
  if (input.templateId) {
    const tpl = await templateBlocks(actor.id, input.templateId, input.locale);
    if (!tpl) throw new DocsPlatformError('template_not_found', 404);
    content = fillTemplateBlocks(tpl.blocks, input.vars ?? {});
    if (!title) title = tpl.title;
    if (!icon) icon = tpl.icon;
  }
  const extra = input.blocks?.length ? input.blocks : input.markdown ? mdToBlocks(input.markdown) : [];
  if (extra.length) content = [...(content ?? []), ...extra.map((b) => ({ ...b, id: crypto.randomUUID() }))];
  const page = await createDocPage(actor.id, { title, parent_id: parentId, icon, content: content?.length ? cleanContent(content) : undefined });
  const row = (await getDb().prepare('SELECT * FROM docs_pages WHERE id = ?').get(page.id)) as DocsPageRow;
  await emitPageCreated(actor.id, row, actorPersonId(actor)).catch(() => {});
  return getPage(actor, page.id);
}

export interface UpdatePageInput {
  title?: string;
  icon?: string | null;
  /** Reemplaza todo el contenido (las bases de la página se conservan si no vienen). */
  markdown?: string;
  blocks?: DocsBlock[];
  /** Agrega al final (o debajo de `afterBlockId`). */
  appendMarkdown?: string;
  appendBlocks?: DocsBlock[];
  afterBlockId?: string | null;
  archived?: boolean;
}

/**
 * Cambia una página. Lee y escribe contra su updated_at (compare-and-set):
 * si otro guardado se cuela, se vuelve a leer y aplicar (hasta 4 veces).
 */
export async function updatePage(actor: DocsActor, pageId: string, input: UpdatePageInput): Promise<PageOut> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const touchesContent = input.title !== undefined || input.icon !== undefined || input.markdown !== undefined || Boolean(input.blocks?.length) || Boolean(input.appendMarkdown) || Boolean(input.appendBlocks?.length);
    if (!touchesContent && input.archived === undefined) throw new DocsPlatformError('missing_fields');
    const res = await pageForWrite(actor, pageId, { includeArchived: input.archived === false, content: touchesContent });
    if (res.access !== 'owner' && input.archived !== undefined) throw new DocsPlatformError('forbidden', 403);
    // La página como la ve el editor de esta persona (sincronizados con su contenido): base del cambio.
    const { editorBlocks, restoreForActor, syncedLocks } = await import('./docs-guard');
    const current = await editorBlocks(res.row, actor);
    let next: DocsBlock[] | undefined;
    const replace = input.blocks?.length ? input.blocks : input.markdown !== undefined ? mdToBlocks(input.markdown) : undefined;
    if (replace) {
      // Las bases no se pueden escribir en Markdown: las que ya estaban quedan al final.
      const keep = current.filter((b) => b.type === 'database');
      next = [...replace.map((b) => ({ ...b, id: crypto.randomUUID() })), ...keep];
    }
    const add = input.appendBlocks?.length ? input.appendBlocks : input.appendMarkdown ? mdToBlocks(input.appendMarkdown) : [];
    if (add.length) {
      const base = next ?? current;
      const fresh = add.map((b) => ({ ...b, id: crypto.randomUUID() }));
      const at = input.afterBlockId ? base.findIndex((b) => b.id === input.afterBlockId) : -1;
      if (input.afterBlockId && at === -1) throw new DocsPlatformError('block_not_found', 404);
      // Una página nueva trae un párrafo vacío: se reemplaza en vez de quedar arriba.
      const trimmed = at === -1 && base.length === 1 && base[0].type === 'paragraph' && !base[0].content?.trim() ? [] : base;
      next = at === -1 ? [...trimmed, ...fresh] : [...base.slice(0, at + 1), ...fresh, ...base.slice(at + 1)];
    }
    // Links a páginas que no puede abrir: vuelven al texto guardado (editorBlocks los muestra como "Página privada").
    if (next) next = await restoreForActor(actor, res.row, next);
    // Sincronizados que esta persona no puede editar en su origen: no se tocan (como en el editor).
    const locks = next ? await syncedLocks(actor, res.row, next) : undefined;
    try {
      const saved = await updateDocPage(
        res.row.user_id,
        pageId,
        {
          ...(input.title !== undefined ? { title: input.title.slice(0, 300) } : {}),
          ...(input.icon !== undefined ? { icon: input.icon } : {}),
          ...(next ? { content: next } : {}),
          ...(input.archived !== undefined ? { archived: input.archived } : {}),
          base_updated_at: res.row.updated_at,
        },
        { actorId: actorPersonId(actor), lockedSynced: locks?.locked, deniedSynced: locks?.denied },
      );
      if (!saved) throw notFound();
      return getPage(actor, pageId, { includeArchived: true });
    } catch (err) {
      if (err instanceof DocsConflictError) continue;
      throw err;
    }
  }
  throw new DocsPlatformError('conflict', 409);
}

// ---------- Comentarios ----------

export interface CommentOut {
  id: string;
  pageId: string;
  blockId: string | null;
  parentId: string | null;
  text: string;
  resolved: boolean;
  author: { id: string; name: string | null; email: string };
  createdAt: string;
}

function commentText(body: string): string {
  return body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

export async function listComments(actor: DocsActor, pageId: string): Promise<CommentOut[]> {
  const res = await pageFor(actor, pageId);
  if (!res) throw notFound();
  return (await listDocComments(pageId)).map((c) => ({
    id: c.id,
    pageId: c.page_id,
    blockId: c.block_id,
    parentId: c.parent_id,
    text: commentText(c.body),
    resolved: c.resolved,
    author: { id: c.user_id, name: c.user_name, email: c.user_email },
    createdAt: c.created_at,
  }));
}

export async function addComment(actor: DocsActor, pageId: string, input: { text: string; blockId?: string | null; parentId?: string | null }): Promise<CommentOut> {
  const res = await pageFor(actor, pageId);
  if (!res) throw notFound();
  // Comentar pide "puede comentar" o más (como en el editor).
  const { canCommentAccess } = await import('./docs-access');
  if (!canCommentAccess(res.access)) throw new DocsPlatformError('forbidden', 403);
  const text = input.text.trim().slice(0, 5000);
  if (!text) throw new DocsPlatformError('empty_comment');
  const { DocsCommentParentError } = await import('./docs');
  let c;
  try {
    c = await createDocComment(pageId, actorPersonId(actor), { body: escapeHtml(text), block_id: input.blockId ?? null, parent_id: input.parentId ?? null });
  } catch (err) {
    if (err instanceof DocsCommentParentError) throw new DocsPlatformError('invalid_parent');
    throw err;
  }
  await emitCommentCreated(res.row.user_id, res.row, c).catch(() => {});
  return {
    id: c.id,
    pageId: c.page_id,
    blockId: c.block_id,
    parentId: c.parent_id,
    text: commentText(c.body),
    resolved: c.resolved,
    author: { id: c.user_id, name: c.user_name, email: c.user_email },
    createdAt: c.created_at,
  };
}

// ---------- Bases ----------

export interface DatabaseOut {
  pageId: string;
  blockId: string;
  title: string;
  page: { id: string; title: string };
  synced: { provider: string; label: string; syncedAt: string | null } | null;
  properties: Array<{ id: string; name: string; type: string; options?: string[] }>;
  rowCount: number;
}

function databaseOut(page: Pick<DocsPageRow, 'id' | 'title'>, blockId: string, db: DocsDatabase): DatabaseOut {
  return {
    pageId: page.id,
    blockId,
    title: db.title ?? '',
    page: { id: page.id, title: page.title },
    synced: db.sync ? { provider: db.sync.provider, label: db.sync.label, syncedAt: db.sync.synced_at ?? null } : null,
    properties: db.properties.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      ...(p.options?.length ? { options: p.options.map((o) => o.name) } : {}),
    })),
    rowCount: db.rows.length,
  };
}

export async function listDatabases(actor: DocsActor, q = ''): Promise<DatabaseOut[]> {
  const needle = q.trim().toLowerCase();
  const out: DatabaseOut[] = [];
  for (const r of await readablePageRows(actor, { limit: 400 })) {
    if (!r.content?.includes('"database"')) continue;
    for (const b of await visibleBlocksFor(r, r.content, { actor })) {
      if (b.type !== 'database' || b.linked) continue;
      const db = normalizeDatabase(b);
      if (needle && !`${db.title ?? ''} ${r.title}`.toLowerCase().includes(needle)) continue;
      out.push(databaseOut(r, b.id, db));
      if (out.length >= 100) return out;
    }
  }
  return out;
}

async function loadReadable(actor: DocsActor, pageId: string, blockId: string) {
  const res = await pageFor(actor, pageId);
  if (!res) throw notFound();
  const block = (await visibleBlocksFor(res.row, res.row.content, { actor })).find((b) => b.id === blockId && b.type === 'database' && !b.linked);
  if (!block) throw new DocsPlatformError('database_not_found', 404);
  return { row: res.row, access: res.access, db: normalizeDatabase(block) };
}

export async function getDatabase(actor: DocsActor, pageId: string, blockId: string): Promise<DatabaseOut> {
  const { row, db } = await loadReadable(actor, pageId, blockId);
  return databaseOut(row, blockId, db);
}

export interface RowOut {
  id: string;
  title: string;
  url: string;
  properties: Record<string, string>;
  values: Record<string, DbValue>;
  createdAt: string;
  updatedAt: string;
}

function rowOut(pageId: string, db: DocsDatabase, row: DbRow, names: Map<string, string>): RowOut {
  const properties: Record<string, string> = {};
  const values: Record<string, DbValue> = {};
  const ctx = { people: Object.fromEntries(names), rowTitles: Object.fromEntries(db.rows.map((r) => [r.id, rowTitle(db, r)])), locale: 'en' };
  for (const p of db.properties) {
    if (p.type === 'title' || p.type === 'button') continue;
    properties[p.name] = formatValue(p, row, ctx);
    values[p.name] = cellValue(p, row);
  }
  return {
    id: row.id,
    title: rowTitle(db, row),
    url: `/app/docs/${pageId}?row=${encodeURIComponent(row.id)}`,
    properties,
    values,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function personNames(page: Pick<DocsPageRow, 'user_id'>): Promise<Map<string, string>> {
  return new Map((await listPageMentionables(page)).map((m) => [m.id, m.name || m.email]));
}

/**
 * Filas de una base. `filter`: propiedad (nombre) → texto que tiene que
 * contener su valor (sin distinguir mayúsculas); `q` busca en el título.
 */
export async function queryRows(
  actor: DocsActor,
  pageId: string,
  blockId: string,
  opts: { filter?: Record<string, string>; q?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: RowOut[]; total: number; hasMore: boolean }> {
  const { row, db } = await loadReadable(actor, pageId, blockId);
  const names = await personNames(row);
  let rows = db.rows.map((r) => rowOut(pageId, db, r, names));
  const q = opts.q?.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.title.toLowerCase().includes(q));
  for (const [name, wanted] of Object.entries(opts.filter ?? {})) {
    const w = String(wanted).toLowerCase();
    const isTitle = titleProperty(db)?.name.toLowerCase() === name.toLowerCase();
    rows = rows.filter((r) => {
      const v = isTitle ? r.title : Object.entries(r.properties).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
      return typeof v === 'string' && v.toLowerCase().includes(w);
    });
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  return { rows: rows.slice(offset, offset + limit), total: rows.length, hasMore: rows.length > offset + limit };
}

export async function getRow(actor: DocsActor, pageId: string, blockId: string, rowId: string): Promise<RowOut & { markdown: string }> {
  const { row, db } = await loadReadable(actor, pageId, blockId);
  const r = db.rows.find((x) => x.id === rowId);
  if (!r) throw new DocsPlatformError('row_not_found', 404);
  return { ...rowOut(pageId, db, r, await personNames(row)), markdown: blocksToMd(r.body ?? []) };
}

/** Propiedad por id o nombre (sin distinguir mayúsculas). */
export function findProperty(db: DocsDatabase, key: string): DbProperty | undefined {
  const k = key.trim().toLowerCase();
  return db.properties.find((p) => p.id === key) ?? db.properties.find((p) => p.name.trim().toLowerCase() === k);
}

/**
 * Valor de entrada (texto, número, booleano, lista) → valor de la propiedad.
 * Select y multi-select crean la opción si no existe (como la API de Notion);
 * status solo acepta sus opciones; persona, por email o id de alguien del
 * workspace. Devuelve el valor y las propiedades a actualizar (opciones nuevas).
 */
export function coerceValue(
  prop: DbProperty,
  raw: unknown,
  people: Array<{ id: string; email: string; name: string | null }>,
): { value: DbValue; property?: DbProperty } {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  const text = Array.isArray(raw) ? raw.map(String).join(',') : String(raw);
  switch (prop.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : parseNumber(text);
      if (n === null || !Number.isFinite(n)) throw new DocsPlatformError(`invalid_value:${prop.name}`);
      return { value: n };
    }
    case 'checkbox':
      return { value: typeof raw === 'boolean' ? raw : parseCheckbox(text) };
    case 'date': {
      const d = parseDateText(text) ?? (/^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null);
      if (!d) throw new DocsPlatformError(`invalid_value:${prop.name}`);
      return { value: d };
    }
    case 'select':
    case 'status':
    case 'multi_select': {
      const names = (Array.isArray(raw) ? raw.map(String) : prop.type === 'multi_select' ? text.split(',') : [text]).map((s) => s.trim()).filter(Boolean);
      const options: DbOption[] = [...(prop.options ?? [])];
      let added = false;
      const ids: string[] = [];
      for (const n of names) {
        const hit = options.find((o) => o.id === n) ?? options.find((o) => o.name.trim().toLowerCase() === n.toLowerCase());
        if (hit) ids.push(hit.id);
        else if (prop.type === 'status') throw new DocsPlatformError(`invalid_option:${prop.name}`);
        else {
          const o = { id: newDbId(), name: n.slice(0, 200) };
          options.push(o);
          ids.push(o.id);
          added = true;
        }
      }
      const value: DbValue = prop.type === 'multi_select' ? [...new Set(ids)] : (ids[0] ?? null);
      return added ? { value, property: { ...prop, options } } : { value };
    }
    case 'person': {
      const list = (Array.isArray(raw) ? raw.map(String) : text.split(',')).map((s) => s.trim().toLowerCase()).filter(Boolean);
      const ids = list.map((v) => people.find((p) => p.id.toLowerCase() === v || p.email.toLowerCase() === v)?.id);
      if (ids.some((x) => !x)) throw new DocsPlatformError(`invalid_person:${prop.name}`);
      return { value: [...new Set(ids as string[])] };
    }
    case 'relation': {
      const ids = (Array.isArray(raw) ? raw.map(String) : text.split(',')).map((s) => s.trim()).filter(Boolean);
      return { value: ids.slice(0, 100) };
    }
    default:
      return { value: text.slice(0, 20_000) };
  }
}

/** Operaciones para escribir `values` (nombre o id de propiedad → valor) en una fila. */
export function valueOps(
  db: DocsDatabase,
  values: Record<string, unknown>,
  people: Array<{ id: string; email: string; name: string | null }>,
): { set: Record<string, DbValue>; title?: string; propertyOps: DbOp[] } {
  const set: Record<string, DbValue> = {};
  const propertyOps: DbOp[] = [];
  let title: string | undefined;
  const tp = titleProperty(db);
  for (const [key, raw] of Object.entries(values)) {
    const prop = findProperty(db, key);
    if (!prop) throw new DocsPlatformError(`unknown_property:${key.slice(0, 60)}`);
    if (prop.id === tp?.id) {
      title = String(raw ?? '').slice(0, 2000);
      continue;
    }
    if (isComputedType(prop.type) || prop.type === 'files' || prop.relation?.mirror_of) throw new DocsPlatformError(`read_only_property:${prop.name}`);
    const res = coerceValue(prop, raw, people);
    if (res.property) propertyOps.push({ op: 'update_property', property: res.property });
    set[prop.id] = res.value;
  }
  return { set, title, propertyOps };
}

function dbError(err: unknown): never {
  if (err instanceof DbServerError) {
    if (err.code === 'forbidden') throw new DocsPlatformError('read_only', 403);
    if (err.code === 'not_found') throw new DocsPlatformError('database_not_found', 404);
    if (err.code === 'conflict') throw new DocsPlatformError('conflict', 409);
    throw new DocsPlatformError('invalid_input');
  }
  throw err;
}

async function writable(actor: DocsActor, pageId: string, blockId: string) {
  const res = await pageForWrite(actor, pageId);
  try {
    const loaded = await loadDatabase(actor, pageId, blockId, { edit: true });
    return { row: res.row, db: loaded.db };
  } catch (err) {
    dbError(err);
  }
}

async function applyOps(actor: DocsActor, pageId: string, blockId: string, ops: DbOp[]) {
  try {
    const actorRun = { ...actor, realId: actorPersonId(actor) };
    const res = await applyRemoteOps(actorRun, pageId, blockId, ops);
    if (res.effects.length) await runDbEffects(res.effects, actorRun).catch(() => {});
    return res.db;
  } catch (err) {
    dbError(err);
  }
}

export interface RowInput {
  values?: Record<string, unknown>;
  title?: string;
  markdown?: string;
  /** Plantilla de fila de la base (id o nombre). */
  template?: string;
}

export async function createRow(actor: DocsActor, pageId: string, blockId: string, input: RowInput): Promise<RowOut> {
  const { row: page, db } = await writable(actor, pageId, blockId);
  const people = await listPageMentionables(page);
  let values: Record<string, DbValue> = {};
  let body: DocsBlock[] | undefined;
  if (input.template) {
    const t = input.template.trim().toLowerCase();
    const tpl = (db.templates ?? []).find((x) => x.id === input.template || x.name.trim().toLowerCase() === t);
    if (!tpl) throw new DocsPlatformError('template_not_found', 404);
    values = { ...tpl.values };
    body = tpl.body?.map((b) => ({ ...b, id: crypto.randomUUID() }));
  }
  const v = valueOps(db, input.values ?? {}, people);
  values = { ...values, ...v.set };
  const extra = input.markdown ? mdToBlocks(input.markdown) : [];
  if (extra.length) body = [...(body ?? []), ...extra];
  const id = newDbId();
  const ops: DbOp[] = [
    ...v.propertyOps,
    { op: 'add_row', id, values, title: (input.title ?? v.title ?? '').slice(0, 2000), ...(body?.length ? { body: cleanContent(body) } : {}) },
  ];
  const next = await applyOps(actor, pageId, blockId, ops);
  const created = next.rows.find((r) => r.id === id);
  if (!created) throw new DocsPlatformError('database_full', 409);
  return rowOut(pageId, next, created, await personNames(page));
}

export async function updateRow(actor: DocsActor, pageId: string, blockId: string, rowId: string, input: RowInput & { appendMarkdown?: string }): Promise<RowOut> {
  const { row: page, db } = await writable(actor, pageId, blockId);
  const current = db.rows.find((r) => r.id === rowId);
  if (!current) throw new DocsPlatformError('row_not_found', 404);
  const people = await listPageMentionables(page);
  const v = valueOps(db, input.values ?? {}, people);
  const ops: DbOp[] = [...v.propertyOps];
  for (const [prop, value] of Object.entries(v.set)) ops.push({ op: 'set_cell', row: rowId, prop, value });
  const title = input.title ?? v.title;
  const tp = titleProperty(db);
  if (title !== undefined && tp) ops.push({ op: 'set_cell', row: rowId, prop: tp.id, value: title });
  if (input.markdown !== undefined) ops.push({ op: 'set_body', row: rowId, body: cleanContent(mdToBlocks(input.markdown)) });
  else if (input.appendMarkdown) ops.push({ op: 'set_body', row: rowId, body: cleanContent([...(current.body ?? []), ...mdToBlocks(input.appendMarkdown)]) });
  if (!ops.length) throw new DocsPlatformError('missing_fields');
  const next = await applyOps(actor, pageId, blockId, ops);
  const r = next.rows.find((x) => x.id === rowId);
  if (!r) throw new DocsPlatformError('row_not_found', 404);
  return rowOut(pageId, next, r, await personNames(page));
}

export async function deleteRow(actor: DocsActor, pageId: string, blockId: string, rowId: string): Promise<void> {
  const { db } = await writable(actor, pageId, blockId);
  if (!db.rows.some((r) => r.id === rowId)) throw new DocsPlatformError('row_not_found', 404);
  await applyOps(actor, pageId, blockId, [{ op: 'delete_rows', rows: [rowId] }]);
}

/** Fila por título exacto (sin distinguir mayúsculas), para Flow ("actualizar la fila «X»"). */
export async function findRowByTitle(actor: DocsActor, pageId: string, blockId: string, title: string): Promise<string | null> {
  const { db } = await loadReadable(actor, pageId, blockId);
  const t = title.trim().toLowerCase();
  return db.rows.find((r) => rowTitle(db, r).trim().toLowerCase() === t)?.id ?? null;
}

/** Bloques de una página (forma cruda), para la API. */
export async function getBlocks(actor: DocsActor, pageId: string): Promise<DocsBlock[]> {
  const res = await pageFor(actor, pageId);
  if (!res) throw notFound();
  return visibleBlocksFor(res.row, res.row.content, { actor });
}

export { stringifyBlocks };
