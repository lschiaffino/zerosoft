/**
 * Docs — import desde Notion por API (token de una integración interna), con
 * el runner de lib/import-runner.ts.
 *
 * Lectura (antes de la vista previa, nada se escribe):
 *   me     → valida el token (GET /users/me) y lee las personas (con email si
 *            la integración tiene "leer información de usuarios").
 *   search → todas las páginas y bases compartidas con la integración. Una
 *            página dentro de un bloque (columna, toggle) sube por sus padres
 *            hasta la página que la contiene.
 *   rows   → las filas de cada base (query paginada): la búsqueda no
 *            garantiza traerlas todas.
 *   Al terminar se ordena todo: padres antes que hijas, bases antes que sus
 *   filas. Cada página, base y fila tiene su id local asignado de antemano
 *   (el de un import anterior si existe), así los links y menciones a una
 *   página que se escribe después ya apuntan bien.
 *
 * Escritura (de a una página: cada una pide sus bloques a la API):
 *   página → bloques convertidos (lib/notion-api.ts), archivos de Notion
 *            bajados al storage propio, links internos reescritos.
 *   base   → página con un bloque database (propiedades y filas).
 *   fila   → el cuerpo de la fila dentro de su base.
 *
 * El token (cifrado) se queda hasta terminar: los archivos de Notion son URLs
 * firmadas que vencen en una hora, así que los bloques se piden recién al
 * escribir. Se borra al terminar, fallar o cancelar. Reimportar actualiza lo
 * ya importado (ids externos) en vez de duplicarlo.
 */
import { createHash } from 'crypto';
import { getDb } from './db';
import {
  getExternalId,
  getExternalIds,
  ImportError,
  ImportRetryError,
  setExternalId,
  updateImportJob,
  type ImportJob,
  type StagedItem,
} from './import-jobs';
import type { FetchStepResult } from './track-import-sources';
import {
  convertBlocks,
  convertDatabase,
  createNotionClient,
  databaseBlockId,
  externalMediaBlock,
  iconEmoji,
  normalizeNotionId,
  pageTitle,
  plainText,
  richTextToHtml,
  stableId,
  type DatabaseConvertContext,
  type NBlock,
  type NBlockNode,
  type NDatabase,
  type NList,
  type NotionClient,
  type NotionConvertContext,
  type NotionMediaRef,
  type NotionRowInput,
  type NPage,
  type NParent,
  type NPropValue,
  type NUser,
} from './notion-api';
import { fakeNotionFetch, isNotionFakeToken, notionFakeAllowed } from './notion-api-fake';
import { stringifyBlocks, type DbFile, type DocsBlock } from './docs-types';
import { fileKindFor } from './docs-files';
import { DOCS_IMPORT_MAX_BLOCKS } from './docs-import';
import { mimeFor } from './docs-notion-import';
import { isAllowedUpload, MAX_UPLOAD_SIZE, saveUpload } from './uploads';
import { safeFetch } from './safe-fetch';
import { workspacePeople } from './crm-import';

export const NOTION_API_SOURCE = 'notion_api';
/** Tope de páginas + bases + filas por import. */
export const NOTION_API_MAX_ITEMS = 5000;
/** Pedidos de bloques por página (a 3 por segundo, unos 50 s). */
const PAGE_MAX_REQUESTS = 150;
const MAX_DEPTH = 8;
const MAX_ERRORS = 100;
/** Búsqueda y filas: pedidos por tramo de lectura. */
const FETCH_REQUESTS_PER_STEP = 4;

export interface NotionApiInclude {
  pages: boolean;
  databases: boolean;
  files: boolean;
  /** Reemplazar con lo de Notion también las páginas editadas en zerosoft después del último import. */
  overwrite: boolean;
}

export const DEFAULT_INCLUDE: NotionApiInclude = { pages: true, databases: true, files: true, overwrite: false };

/** Página, base o fila leída (lo que queda en import_job_items). */
export interface StagedNotion {
  /** Id de Notion normalizado (sin guiones). */
  id: string;
  kind: 'page' | 'database';
  title: string;
  icon: string | null;
  parent: { type: 'workspace' | 'page' | 'database'; id: string | null };
  created: string;
  edited: string;
  /** Página local (de la página o de la base). En una fila: la página de su base, se resuelve al escribir. */
  localId: string;
  /** Solo filas: id de la fila dentro de la base (estable). */
  rowId?: string;
  /** Ya importada antes (la página local sigue existiendo): se actualiza. */
  existing: boolean;
  /** Ya importada y editada en zerosoft después del último import (vista previa). */
  localEdited?: boolean;
  /** Filas: valores de las propiedades. */
  properties?: Record<string, NPropValue>;
  /** Bases: esquema y descripción. */
  schema?: Pick<NDatabase, 'id' | 'title' | 'description' | 'properties' | 'parent' | 'object' | 'created_time' | 'last_edited_time'>;
}

export interface NotionApiReport {
  [key: string]: unknown;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  pages: number;
  databases: number;
  rows: number;
  files: number;
  filesSkipped: number;
  /** "Página: motivo" (hasta 100). */
  errors: string[];
  errorCount: number;
  roots: Array<{ id: string; title: string }>;
  /** Editadas en zerosoft después del último import: no se pisaron. */
  kept: number;
  /** Ya importadas en otro lugar que el destino elegido: quedaron donde estaban. */
  notMoved: number;
}

export function emptyNotionApiReport(): NotionApiReport {
  return { created: 0, updated: 0, skipped: 0, failed: 0, pages: 0, databases: 0, rows: 0, files: 0, filesSkipped: 0, errors: [], errorCount: 0, roots: [], kept: 0, notMoved: 0 };
}

// ---------- Cliente ----------

type ClientFactory = (token: string) => NotionClient;

const defaultFactory: ClientFactory = (token) =>
  notionFakeAllowed() && isNotionFakeToken(token)
    ? createNotionClient(token, { fetch: fakeNotionFetch(), noThrottle: true })
    : createNotionClient(token);

let clientFactory: ClientFactory = defaultFactory;

/** Solo tests: cómo se crea el cliente (null vuelve al default). */
export function setNotionClientFactory(f: ClientFactory | null): void {
  clientFactory = f ?? defaultFactory;
}

function clientFor(job: ImportJob): NotionClient {
  if (!job.secret) throw new ImportError('unauthorized');
  return clientFactory(job.secret);
}

// ---------- Lectura ----------

interface Cursor {
  phase?: 'me' | 'search' | 'rows';
  next?: string | null;
  db?: number;
}

async function listUsers(client: NotionClient): Promise<NUser[]> {
  const out: NUser[] = [];
  let next: string | null = null;
  for (let i = 0; i < 20; i++) {
    const res: NList<{ id: string; type?: string; name?: string | null; person?: { email?: string } }> = await client.get(
      `/users?page_size=100${next ? `&start_cursor=${encodeURIComponent(next)}` : ''}`,
    );
    for (const u of res.results ?? []) {
      if (u.type === 'bot') continue;
      out.push({ id: normalizeNotionId(u.id), name: (u.name ?? '').slice(0, 200), email: (u.person?.email ?? '').toLowerCase().slice(0, 254) });
    }
    next = res.has_more ? res.next_cursor : null;
    if (!next) break;
  }
  return out;
}

/** Ids ya leídos en este job (la búsqueda y las filas pueden repetir). */
async function knownIds(jobId: string, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (!chunk.length) continue;
    const rows = (await getDb()
      .prepare(
        `SELECT json_extract(data, '$.id') AS id FROM import_job_items
         WHERE job_id = ? AND kind IN ('page', 'database') AND json_extract(data, '$.id') IN (${chunk.map(() => '?').join(', ')})`,
      )
      .all(jobId, ...chunk)) as Array<{ id: string }>;
    for (const r of rows) out.add(String(r.id));
  }
  return out;
}

/** Una página dentro de un bloque: sube por los padres del bloque hasta una página, base o el workspace. */
async function resolveParent(client: NotionClient, parent: NParent): Promise<StagedNotion['parent']> {
  let p: NParent | undefined = parent;
  for (let i = 0; i < 6 && p; i++) {
    if (p.type === 'workspace') return { type: 'workspace', id: null };
    if (p.type === 'page_id') return { type: 'page', id: normalizeNotionId(p.page_id) };
    if (p.type === 'database_id') return { type: 'database', id: normalizeNotionId(p.database_id) };
    try {
      const b: NBlock = await client.get(`/blocks/${encodeURIComponent(p.block_id)}`);
      p = b.parent;
    } catch (e) {
      if (e instanceof ImportRetryError || (e instanceof ImportError && e.code === 'unauthorized')) throw e;
      break;
    }
  }
  return { type: 'workspace', id: null };
}

/** Páginas locales que siguen existiendo (no borradas) del workspace → si se editaron después del último import. */
async function livePages(workspaceId: string, ids: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (!chunk.length) continue;
    const rows = (await getDb()
      .prepare(
        `SELECT p.id, p.updated_at > COALESCE(e.imported_at, replace(e.created_at, ' ', 'T')) AS edited FROM docs_pages p
         LEFT JOIN import_external_ids e ON e.workspace_id = p.user_id AND e.source = '${'notion_api'}' AND e.kind = 'page' AND e.local_id = p.id
         WHERE p.user_id = ? AND p.archived = 0 AND p.id IN (${chunk.map(() => '?').join(', ')})`,
      )
      .all(workspaceId, ...chunk)) as Array<{ id: string; edited: number | null }>;
    for (const r of rows) out.set(r.id, Boolean(r.edited));
  }
  return out;
}

/** ¿La página importada se editó en zerosoft después del último import que la escribió? */
async function pageEditedLocally(workspaceId: string, notionId: string, localId: string): Promise<boolean> {
  const row = (await getDb()
    .prepare(
      `SELECT p.updated_at > COALESCE(e.imported_at, replace(e.created_at, ' ', 'T')) AS edited FROM docs_pages p
       JOIN import_external_ids e ON e.workspace_id = p.user_id AND e.source = ? AND e.kind = 'page' AND e.external_id = ? AND e.local_id = p.id
       WHERE p.id = ? AND p.user_id = ?`,
    )
    .get(NOTION_API_SOURCE, notionId, localId, workspaceId)) as { edited: number } | undefined;
  return Boolean(row?.edited);
}

async function stageObjects(job: ImportJob, client: NotionClient, objs: Array<NPage | NDatabase>): Promise<Array<{ kind: string; data: StagedNotion }>> {
  const fresh = objs.filter((o) => (o.object === 'page' || o.object === 'database') && !o.archived && !o.in_trash);
  const ids = [...new Set(fresh.map((o) => normalizeNotionId(o.id)))];
  const known = await knownIds(job.id, ids);
  const todo = fresh.filter((o, i) => !known.has(normalizeNotionId(o.id)) && fresh.findIndex((x) => x.id === o.id) === i);
  const mapped = await getExternalIds(job.workspace_id, NOTION_API_SOURCE, 'page', todo.map((o) => normalizeNotionId(o.id)));
  const alive = await livePages(job.workspace_id, [...mapped.values()]);
  const out: Array<{ kind: string; data: StagedNotion }> = [];
  for (const o of todo) {
    const id = normalizeNotionId(o.id);
    const parent = await resolveParent(client, o.parent);
    const prev = mapped.get(id);
    const existing = Boolean(prev && alive.has(prev));
    const localEdited = existing && alive.get(prev!) === true;
    const base: StagedNotion = {
      id,
      kind: o.object === 'database' ? 'database' : 'page',
      title: pageTitle(o).slice(0, 500),
      icon: iconEmoji(o.icon ?? null),
      parent,
      created: o.created_time,
      edited: o.last_edited_time,
      localId: existing ? prev! : crypto.randomUUID(),
      existing,
      ...(localEdited ? { localEdited: true } : {}),
    };
    if (o.object === 'database') {
      base.schema = {
        object: 'database',
        id: o.id,
        title: o.title,
        description: o.description ?? [],
        properties: o.properties,
        parent: o.parent,
        created_time: o.created_time,
        last_edited_time: o.last_edited_time,
      };
    } else if (parent.type === 'database') {
      base.rowId = stableId(id, 'row');
      base.properties = o.properties;
    }
    out.push({ kind: base.kind, data: base });
  }
  return out;
}

async function stagedDatabaseAt(jobId: string, index: number): Promise<StagedNotion | null> {
  const row = (await getDb()
    .prepare(`SELECT data FROM import_job_items WHERE job_id = ? AND kind = 'database' ORDER BY seq LIMIT 1 OFFSET ?`)
    .get(jobId, index)) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as StagedNotion) : null;
}

export async function notionApiFetchStep(job: ImportJob): Promise<FetchStepResult> {
  const client = clientFor(job);
  const c = job.cursor as Cursor;
  const phase = c.phase ?? 'me';

  if (phase === 'me') {
    const me: { name?: string; bot?: { workspace_name?: string | null } } = await client.get('/users/me');
    const account = (me.bot?.workspace_name || me.name || '').slice(0, 200);
    await updateImportJob(job.id, { options: { ...job.options, account } });
    let users: NUser[] = [];
    try {
      users = await listUsers(client);
    } catch (e) {
      // Sin "leer información de usuarios": las personas van como texto.
      if (!(e instanceof ImportError) || e.code === 'unauthorized') throw e;
    }
    return { items: [{ kind: 'users', data: { users } }], cursor: { phase: 'search', next: null }, done: false };
  }

  if (phase === 'search') {
    const found: Array<NPage | NDatabase> = [];
    let next = c.next ?? null;
    for (let i = 0; i < FETCH_REQUESTS_PER_STEP; i++) {
      const res: NList<NPage | NDatabase> = await client.post('/search', { page_size: 100, ...(next ? { start_cursor: next } : {}) });
      found.push(...(res.results ?? []));
      next = res.has_more ? res.next_cursor : null;
      if (!next) break;
    }
    const items = await stageObjects(job, client, found);
    return { items, cursor: next ? { phase: 'search', next } : { phase: 'rows', db: 0, next: null }, done: false };
  }

  // rows: query de cada base, por tramos.
  let index = c.db ?? 0;
  let next = c.next ?? null;
  const items: Array<{ kind: string; data: StagedNotion }> = [];
  for (let i = 0; i < FETCH_REQUESTS_PER_STEP; i++) {
    const db = await stagedDatabaseAt(job.id, index);
    if (!db) return { items, cursor: {}, done: true };
    let res: NList<NPage>;
    try {
      res = await client.post(`/databases/${encodeURIComponent(db.schema?.id ?? db.id)}/query`, { page_size: 100, ...(next ? { start_cursor: next } : {}) });
    } catch (e) {
      // Base sin acceso para la query: quedan las filas que trajo la búsqueda.
      if (e instanceof ImportError && (e.code === 'restricted' || e.code === 'not_found' || e.code === 'invalid_request')) {
        index += 1;
        next = null;
        continue;
      }
      throw e;
    }
    items.push(...(await stageObjects(job, client, res.results ?? [])));
    next = res.has_more ? res.next_cursor : null;
    if (!next) index += 1;
  }
  return { items, cursor: { phase: 'rows', db: index, next }, done: false };
}

// ---------- Orden y vista previa ----------

/**
 * Orden de escritura: el árbol de páginas y bases (cada una antes que sus
 * hijas), después las páginas que cuelgan de una fila (van debajo de la base)
 * y al final las filas, cuando su base ya existe. Puro (testeable).
 */
export function orderForWrite(items: StagedNotion[]): StagedNotion[] {
  const rows = items.filter((i) => i.kind === 'page' && i.parent.type === 'database');
  const nodes = items.filter((i) => !(i.kind === 'page' && i.parent.type === 'database'));
  const rowIds = new Set(rows.map((r) => r.id));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const children = new Map<string, StagedNotion[]>();
  for (const n of nodes) {
    if (n.parent.id && nodeIds.has(n.parent.id) && n.parent.id !== n.id) {
      const list = children.get(n.parent.id) ?? [];
      list.push(n);
      children.set(n.parent.id, list);
    }
  }
  const out: StagedNotion[] = [];
  const seen = new Set<string>();
  const walk = (n: StagedNotion) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    out.push(n);
    for (const c of children.get(n.id) ?? []) walk(c);
  };
  const isRoot = (n: StagedNotion) => !n.parent.id || !nodeIds.has(n.parent.id);
  for (const n of nodes) if (isRoot(n) && !(n.parent.id && rowIds.has(n.parent.id))) walk(n);
  for (const n of nodes) if (isRoot(n) && n.parent.id && rowIds.has(n.parent.id)) walk(n);
  // Ciclos raros (padre e hija apuntándose): entran igual.
  for (const n of nodes) walk(n);
  return [...out, ...rows];
}

/** Reescribe los items en el orden de escritura (mismo total, seq correlativo). */
async function reorderStaged(jobId: string, items: StagedItem[]): Promise<void> {
  const users = items.filter((i) => i.kind === 'users');
  const ordered = orderForWrite(items.filter((i) => i.kind === 'page' || i.kind === 'database').map((i) => i.data as unknown as StagedNotion));
  const rest = items.filter((i) => i.kind !== 'users' && i.kind !== 'page' && i.kind !== 'database');
  const all = [...users.map((u) => ({ kind: u.kind, data: u.data })), ...ordered.map((d) => ({ kind: d.kind, data: d })), ...rest.map((r) => ({ kind: r.kind, data: r.data }))];
  const db = getDb();
  await db.prepare('DELETE FROM import_job_items WHERE job_id = ?').run(jobId);
  for (let i = 0; i < all.length; i += 100) {
    const batch = all.slice(i, i + 100);
    const args: Array<string | number> = [];
    batch.forEach((item, k) => args.push(jobId, i + k, item.kind, JSON.stringify(item.data)));
    await db.prepare(`INSERT INTO import_job_items (job_id, seq, kind, data) VALUES ${batch.map(() => '(?, ?, ?, ?)').join(', ')}`).run(...args);
  }
}

export async function notionApiPreview(job: ImportJob, items: StagedItem[]): Promise<Record<string, unknown>> {
  await reorderStaged(job.id, items);
  const staged = items.filter((i) => i.kind === 'page' || i.kind === 'database').map((i) => i.data as unknown as StagedNotion);
  const users = ((items.find((i) => i.kind === 'users')?.data as { users?: NUser[] } | undefined)?.users ?? []) as NUser[];
  const rows = staged.filter((s) => s.kind === 'page' && s.parent.type === 'database');
  const pages = staged.filter((s) => s.kind === 'page' && s.parent.type !== 'database');
  const dbs = staged.filter((s) => s.kind === 'database');
  const ordered = orderForWrite(staged);
  const ids = new Set(staged.map((s) => s.id));
  return {
    account: String(job.options.account ?? ''),
    pages: pages.length,
    databases: dbs.length,
    rows: rows.length,
    people: users.length,
    peopleWithEmail: users.filter((u) => u.email).length,
    alreadyImported: staged.filter((s) => s.existing).length,
    localEdited: staged.filter((s) => s.localEdited).length,
    // Al menos un pedido por página, fila y base, a 3 por segundo (con algo de margen por los hijos).
    estimateMinutes: Math.round(((pages.length + rows.length + dbs.length) * 1.5) / 3 / 60),
    maxItems: NOTION_API_MAX_ITEMS,
    roots: ordered
      .filter((s) => !(s.kind === 'page' && s.parent.type === 'database') && (!s.parent.id || !ids.has(s.parent.id)))
      .slice(0, 12)
      .map((s) => ({ title: s.title || 'Untitled', kind: s.kind })),
  };
}

// ---------- Escritura ----------

interface IndexEntry {
  id: string;
  kind: 'page' | 'database';
  localId: string;
  rowId: string | null;
  title: string;
  parentType: string;
  parentId: string | null;
}

interface WriteIndex {
  entries: Map<string, IndexEntry>;
  users: Map<string, NUser>;
  people: Map<string, string>;
}

const indexCache = new Map<string, WriteIndex>();

/** Índice de lo leído (ids locales, títulos, personas), una vez por job y proceso. */
async function writeIndex(job: ImportJob): Promise<WriteIndex> {
  const hit = indexCache.get(job.id);
  if (hit) return hit;
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT json_extract(data, '$.id') AS id, kind, json_extract(data, '$.localId') AS localId, json_extract(data, '$.rowId') AS rowId,
              json_extract(data, '$.title') AS title, json_extract(data, '$.parent.type') AS parentType, json_extract(data, '$.parent.id') AS parentId
       FROM import_job_items WHERE job_id = ? AND kind IN ('page', 'database')`,
    )
    .all(job.id)) as Array<Omit<IndexEntry, 'kind'> & { kind: string }>;
  const entries = new Map<string, IndexEntry>();
  for (const r of rows) entries.set(String(r.id), { ...r, kind: r.kind === 'database' ? 'database' : 'page', rowId: r.rowId ?? null } as IndexEntry);
  const usersRow = (await db.prepare(`SELECT data FROM import_job_items WHERE job_id = ? AND kind = 'users' LIMIT 1`).get(job.id)) as { data: string } | undefined;
  const users = new Map<string, NUser>();
  for (const u of (usersRow ? (JSON.parse(usersRow.data) as { users: NUser[] }).users : []) ?? []) users.set(u.id, u);
  const people = new Map<string, string>();
  for (const p of await workspacePeople(job.workspace_id, db)) if (p.email) people.set(p.email.toLowerCase(), p.id);
  const idx = { entries, users, people };
  indexCache.set(job.id, idx);
  if (indexCache.size > 4) indexCache.delete(indexCache.keys().next().value as string);
  return idx;
}

function convertContext(idx: WriteIndex): NotionConvertContext {
  return {
    pageFor(notionId) {
      const e = idx.entries.get(notionId);
      if (!e) return null;
      if (e.kind === 'page' && e.parentType === 'database' && e.rowId && e.parentId) {
        const dbe = idx.entries.get(e.parentId);
        return dbe ? { pageId: dbe.localId, rowId: e.rowId } : null;
      }
      return { pageId: e.localId };
    },
    titleFor: (id) => idx.entries.get(id)?.title ?? null,
    userName: (id) => idx.users.get(normalizeNotionId(id))?.name ?? null,
  };
}

interface BlockFetchResult {
  nodes: NBlockNode[];
  truncated: boolean;
}

/** Bloques de una página, con sus hijos (toggles, listas, columnas, tablas, sincronizados), con tope de pedidos. */
export async function fetchBlockTree(client: NotionClient, pageId: string): Promise<BlockFetchResult> {
  let requests = 0;
  let count = 0;
  let truncated = false;
  async function children(blockId: string, depth: number): Promise<NBlockNode[]> {
    const out: NBlockNode[] = [];
    let next: string | null = null;
    do {
      if (requests >= PAGE_MAX_REQUESTS || count >= DOCS_IMPORT_MAX_BLOCKS) {
        truncated = true;
        return out;
      }
      requests += 1;
      const res: NList<NBlock> = await client.get(
        `/blocks/${encodeURIComponent(blockId)}/children?page_size=100${next ? `&start_cursor=${encodeURIComponent(next)}` : ''}`,
      );
      for (const b of res.results ?? []) {
        count += 1;
        out.push({ block: b, children: [] });
      }
      next = res.has_more ? res.next_cursor : null;
    } while (next);
    for (const node of out) {
      const b = node.block;
      if (!b.has_children || b.type === 'child_page' || b.type === 'child_database') continue;
      if (depth >= MAX_DEPTH) {
        truncated = true;
        continue;
      }
      // Sincronizado que es copia: el contenido vive en el original.
      const from = b.type === 'synced_block' ? ((b.synced_block as { synced_from?: { block_id?: string } | null })?.synced_from?.block_id ?? null) : null;
      try {
        node.children = await children(from ?? b.id, depth + 1);
      } catch (e) {
        // Un original sin compartir: el sincronizado queda vacío.
        if (from && e instanceof ImportError && (e.code === 'not_found' || e.code === 'restricted')) continue;
        throw e;
      }
    }
    return out;
  }
  const nodes = await children(pageId, 0);
  return { nodes, truncated };
}

const NOTION_FILE_HOSTS = [/(^|\.)amazonaws\.com$/i, /(^|\.)notion\.so$/i, /(^|\.)notion\.com$/i, /(^|\.)notion-static\.com$/i, /(^|\.)notionusercontent\.com$/i];

/** ¿Es un archivo alojado por Notion? (solo esos se bajan; los externos quedan como link). */
export function isNotionFileHost(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && NOTION_FILE_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

async function readCapped(res: Response, max: number): Promise<Buffer | null> {
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > max) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return Buffer.from(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** GET de un archivo de Notion siguiendo redirects solo a hosts de Notion (y su S3). */
async function fetchNotionFile(client: NotionClient, url: string): Promise<Response | null> {
  if (client.fake) return client.fetchFile(url);
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!isNotionFileHost(current)) return null;
    const res = await safeFetch(current, {}, 30_000, { maxRedirects: 0 });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined);
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  return null;
}

type StoredFile = { url: string; name: string; size: number; mime: string };

/** Clave estable de un archivo de Notion: la URL sin la firma (cambia en cada pedido). */
function fileKey(url: string): string {
  try {
    const u = new URL(url);
    return createHash('sha1').update(`${u.host}${u.pathname}`).digest('hex');
  } catch {
    return createHash('sha1').update(url).digest('hex');
  }
}

/**
 * Baja un archivo de Notion al storage propio (o reusa el que ya bajó un
 * import anterior). null si es muy grande, de un tipo no permitido o falla.
 */
async function downloadFile(client: NotionClient, job: ImportJob, url: string, name: string): Promise<StoredFile | null> {
  if (!isNotionFileHost(url)) return null;
  const key = fileKey(url);
  const prev = await getExternalId(job.workspace_id, NOTION_API_SOURCE, 'file', key);
  if (prev) {
    try {
      // Mismo archivo de Notion ya copiado: se reusa (con el nombre que trae este bloque).
      return { ...(JSON.parse(prev) as StoredFile), name: (name || 'file').replace(/[\\/]/g, '_').slice(0, 200) };
    } catch {
      // Se vuelve a bajar.
    }
  }
  const saved = await downloadFresh(client, url, name);
  if (saved) await setExternalId(job.workspace_id, NOTION_API_SOURCE, 'file', key, JSON.stringify(saved));
  return saved;
}

async function downloadFresh(client: NotionClient, url: string, name: string): Promise<StoredFile | null> {
  try {
    const res = await fetchNotionFile(client, url);
    if (!res) return null;
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const buf = await readCapped(res, MAX_UPLOAD_SIZE);
    if (!buf) return null;
    const safeName = (name || 'file').replace(/[\\/]/g, '_').slice(0, 200);
    const header = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    const mime = header && header !== 'application/octet-stream' && header !== 'binary/octet-stream' ? header : mimeFor(safeName);
    if (!isAllowedUpload(safeName, mime)) return null;
    const stored = await saveUpload('docs', safeName, mime, buf);
    return { url: stored, name: safeName, size: buf.length, mime };
  } catch {
    return null;
  }
}

function pushError(report: NotionApiReport, msg: string) {
  report.errorCount += 1;
  if (report.errors.length < MAX_ERRORS) report.errors.push(msg.slice(0, 300));
}

function includeOf(job: ImportJob): NotionApiInclude {
  const inc = (job.options.include ?? {}) as Partial<NotionApiInclude>;
  return {
    pages: inc.pages !== false,
    databases: inc.databases !== false,
    files: inc.files !== false,
    overwrite: inc.overwrite === true,
  };
}

/** Bloques de una página o fila: convertidos y con los archivos ya resueltos. */
async function pageBlocks(client: NotionClient, job: ImportJob, idx: WriteIndex, n: StagedNotion, report: NotionApiReport): Promise<DocsBlock[]> {
  const tree = await fetchBlockTree(client, n.id);
  if (tree.truncated) pushError(report, `${n.title || 'Untitled'}: content_truncated`);
  const conv = convertBlocks(tree.nodes, convertContext(idx));
  const byMarker = new Map(conv.media.map((m) => [m.marker, m]));
  const include = includeOf(job);
  const out: DocsBlock[] = [];
  for (const b of conv.blocks) {
    const ref: NotionMediaRef | undefined = b.type === 'paragraph' ? byMarker.get(b.content) : undefined;
    if (!ref) {
      out.push(b);
      continue;
    }
    const keep = b.indent ? { indent: b.indent } : {};
    if (!ref.hosted) {
      out.push({ ...externalMediaBlock(ref), ...keep });
      continue;
    }
    const saved = include.files ? await downloadFile(client, job, ref.url, ref.name) : null;
    if (!saved) {
      report.filesSkipped += 1;
      out.push({ id: b.id, type: 'paragraph', content: ref.name.replace(/[<&>]/g, ''), ...keep });
      continue;
    }
    report.files += 1;
    const kind = ref.kind === 'file' ? 'file' : fileKindFor(saved.mime);
    out.push({ id: b.id, type: kind, content: '', url: saved.url, name: saved.name, size: saved.size, mime: saved.mime, ...(ref.caption ? { caption: ref.caption } : {}), ...keep });
  }
  return out.slice(0, DOCS_IMPORT_MAX_BLOCKS);
}

async function canStillWrite(job: ImportJob, teamspaceId: string | null): Promise<boolean> {
  if (!teamspaceId) return true;
  const { getTeamspace } = await import('./docs-access');
  const ts = await getTeamspace(teamspaceId);
  return Boolean(ts && ts.workspace_id === job.workspace_id && !ts.deleted_at);
}

/** Página local de destino (padre importado y vivo) y su teamspace. */
async function placement(job: ImportJob, idx: WriteIndex, n: StagedNotion): Promise<{ parentId: string | null; teamspaceId: string | null }> {
  const dest = typeof job.options.teamspace_id === 'string' ? job.options.teamspace_id : null;
  let parentLocal: string | null = null;
  if (n.parent.id) {
    const p = idx.entries.get(n.parent.id);
    if (p) {
      // Hija de una fila: va debajo de la página de la base.
      if (p.kind === 'page' && p.parentType === 'database' && p.parentId) parentLocal = idx.entries.get(p.parentId)?.localId ?? null;
      else parentLocal = p.localId;
    }
  }
  if (parentLocal) {
    const row = (await getDb().prepare('SELECT teamspace_id FROM docs_pages WHERE id = ? AND user_id = ? AND archived = 0').get(parentLocal, job.workspace_id)) as
      | { teamspace_id: string | null }
      | undefined;
    if (row) return { parentId: parentLocal, teamspaceId: row.teamspace_id ?? null };
  }
  return { parentId: null, teamspaceId: dest };
}

async function savePage(
  job: ImportJob,
  n: StagedNotion,
  where: { parentId: string | null; teamspaceId: string | null },
  title: string,
  content: DocsBlock[],
  report: NotionApiReport,
): Promise<void> {
  const db = getDb();
  const { cleanContent } = await import('./docs');
  const body = stringifyBlocks(cleanContent(content.length ? content : [{ id: crypto.randomUUID(), type: 'paragraph', content: '' }]));
  const now = new Date().toISOString();
  const exists = (await db.prepare('SELECT parent_id, teamspace_id FROM docs_pages WHERE id = ? AND user_id = ?').get(n.localId, job.workspace_id)) as
    | { parent_id: string | null; teamspace_id: string | null }
    | undefined;
  if (exists) {
    // Reimportar con otro destino: lo ya importado queda donde está (se avisa en el informe).
    if (!exists.parent_id && !where.parentId && (exists.teamspace_id ?? null) !== (where.teamspaceId ?? null)) report.notMoved += 1;
    await db
      .prepare('UPDATE docs_pages SET title = ?, icon = ?, content = ?, archived = 0, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(title, n.icon, body, now, n.localId, job.workspace_id);
  } else {
    await db
      .prepare('INSERT INTO docs_pages (id, user_id, parent_id, title, icon, content, teamspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(n.localId, job.workspace_id, where.parentId, title, n.icon, body, where.teamspaceId, n.created || now, n.edited || now);
  }
  await setExternalId(job.workspace_id, NOTION_API_SOURCE, 'page', n.id, n.localId);
  if (n.existing || exists) report.updated += 1;
  else report.created += 1;
  if (!where.parentId && report.roots.length < 10) report.roots.push({ id: n.localId, title: title.slice(0, 200) });
}

async function stagedRowsOf(jobId: string, dbNotionId: string): Promise<StagedNotion[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT data FROM import_job_items WHERE job_id = ? AND kind = 'page' AND json_extract(data, '$.parent.type') = 'database'
       AND json_extract(data, '$.parent.id') = ? ORDER BY seq`,
    )
    .all(jobId, dbNotionId)) as Array<{ data: string }>;
  return rows.map((r) => JSON.parse(r.data) as StagedNotion);
}

/** Página ya importada y editada en zerosoft: sin "Reemplazar" no se pisa. */
async function keptLocally(job: ImportJob, n: StagedNotion): Promise<boolean> {
  if (!n.existing || includeOf(job).overwrite) return false;
  return pageEditedLocally(job.workspace_id, n.id, n.localId);
}

async function writeDatabase(client: NotionClient, job: ImportJob, idx: WriteIndex, n: StagedNotion, report: NotionApiReport): Promise<void> {
  if (!n.schema) return;
  const rows = await stagedRowsOf(job.id, n.id);
  const inputs: NotionRowInput[] = rows.map((r) => ({ notionId: r.id, rowId: r.rowId ?? stableId(r.id, 'row'), created: r.created, edited: r.edited, properties: r.properties ?? {} }));
  const base = convertContext(idx);
  const ctx: DatabaseConvertContext = {
    ...base,
    personFor: (email) => (email ? (idx.people.get(email.toLowerCase()) ?? null) : null),
    user: (id) => idx.users.get(normalizeNotionId(id)) ?? null,
    databaseFor(dbId) {
      const e = idx.entries.get(dbId);
      return e && e.kind === 'database' ? { pageId: e.localId, blockId: databaseBlockId(dbId) } : null;
    },
    rowFor: (pageId) => idx.entries.get(pageId)?.rowId ?? null,
  };
  const conv = convertDatabase(n.schema as NDatabase, inputs, ctx);
  const include = includeOf(job);
  const byRow = new Map(conv.block.db!.rows.map((r) => [r.id, r]));
  for (const f of conv.files) {
    const row = byRow.get(f.rowId);
    if (!row) continue;
    const saved = include.files && f.hosted ? await downloadFile(client, job, f.url, f.name) : null;
    if (!saved) {
      report.filesSkipped += 1;
      continue;
    }
    report.files += 1;
    const file: DbFile = { id: crypto.randomUUID(), url: saved.url, name: saved.name, size: saved.size, mime: saved.mime };
    row.files = { ...(row.files ?? {}), [f.propId]: [...(row.files?.[f.propId] ?? []), file] };
  }
  // Reimportar: los cuerpos de filas ya importados se mantienen hasta que su fila se reescribe.
  if (n.existing) {
    const prev = (await getDb().prepare('SELECT content FROM docs_pages WHERE id = ? AND user_id = ?').get(n.localId, job.workspace_id)) as { content: string } | undefined;
    const old = prev ? (JSON.parse(prev.content) as DocsBlock[]).find((b) => b.id === conv.block.id) : undefined;
    for (const r of old?.db?.rows ?? []) {
      const now = byRow.get(r.id);
      if (now && r.body?.length) now.body = r.body;
    }
  }
  const content: DocsBlock[] = [];
  const description = richTextToHtml(n.schema.description ?? [], base);
  if (plainText(n.schema.description ?? []).trim()) content.push({ id: stableId(n.id, 'desc'), type: 'paragraph', content: description });
  content.push(conv.block);
  await savePage(job, n, await placement(job, idx, n), (n.title || 'Untitled').slice(0, 500), content, report);
  report.databases += 1;
}

/**
 * Cuerpos de filas de una misma base, en una sola escritura de la página de
 * la base (una base grande no reescribe su contenido una vez por fila).
 */
async function writeRows(client: NotionClient, job: ImportJob, idx: WriteIndex, rows: StagedNotion[], report: NotionApiReport): Promise<void> {
  const dbNotionId = rows[0]?.parent.id;
  const dbEntry = dbNotionId ? idx.entries.get(dbNotionId) : undefined;
  if (!dbEntry || !dbNotionId) {
    report.skipped += rows.length;
    return;
  }
  const db = getDb();
  // La base se editó acá después de importarla (y no se pidió reemplazar): sus filas tampoco se pisan.
  if (!includeOf(job).overwrite && (await pageEditedLocally(job.workspace_id, dbNotionId, dbEntry.localId))) {
    report.kept += rows.length;
    return;
  }
  const bodies = new Map<string, DocsBlock[]>();
  for (const n of rows) {
    if (!n.rowId) continue;
    try {
      bodies.set(n.rowId, (await pageBlocks(client, job, idx, n, report)).filter((b) => !(b.type === 'paragraph' && !b.content)));
    } catch (e) {
      if (e instanceof ImportRetryError || (e instanceof ImportError && e.code === 'unauthorized')) throw e;
      report.failed += 1;
      pushError(report, `${n.title || 'Untitled'}: ${e instanceof ImportError ? e.code : 'internal_error'}`);
    }
  }
  const page = (await db.prepare('SELECT content FROM docs_pages WHERE id = ? AND user_id = ?').get(dbEntry.localId, job.workspace_id)) as { content: string } | undefined;
  if (!page) {
    report.skipped += rows.length;
    return;
  }
  const blocks = JSON.parse(page.content) as DocsBlock[];
  const dbBlock = blocks.find((b) => b.id === databaseBlockId(dbNotionId));
  const { cleanContent } = await import('./docs');
  for (const r of dbBlock?.db?.rows ?? []) {
    const body = bodies.get(r.id);
    if (!body) continue;
    if (body.length) r.body = cleanContent(body).slice(0, DOCS_IMPORT_MAX_BLOCKS);
    else delete r.body;
  }
  await db.prepare('UPDATE docs_pages SET content = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(stringifyBlocks(blocks), new Date().toISOString(), dbEntry.localId, job.workspace_id);
  // Escribirla no es "editarla acá": se renueva la fecha del último import de la base.
  await setExternalId(job.workspace_id, NOTION_API_SOURCE, 'page', dbNotionId, dbEntry.localId);
  for (const n of rows) {
    if (!n.rowId || !bodies.has(n.rowId)) continue;
    await setExternalId(job.workspace_id, NOTION_API_SOURCE, 'row', n.id, n.rowId);
    report.rows += 1;
  }
}

export async function notionApiWriteStep(job: ImportJob, items: StagedItem[], report: NotionApiReport): Promise<void> {
  const dest = typeof job.options.teamspace_id === 'string' ? job.options.teamspace_id : null;
  if (!(await canStillWrite(job, dest))) throw new ImportError('forbidden');
  const include = includeOf(job);
  let client: NotionClient | null = null;
  // Filas seguidas de la misma base: se escriben juntas.
  let rowBatch: StagedNotion[] = [];
  const flushRows = async () => {
    if (!rowBatch.length) return;
    const batch = rowBatch;
    rowBatch = [];
    client ??= clientFor(job);
    await writeRows(client, job, await writeIndex(job), batch, report);
  };
  for (const item of items) {
    if (item.kind !== 'page' && item.kind !== 'database') continue;
    const n = item.data as unknown as StagedNotion;
    const isRow = n.kind === 'page' && n.parent.type === 'database';
    if ((n.kind === 'database' || isRow) && !include.databases) {
      report.skipped += 1;
      continue;
    }
    if (n.kind === 'page' && !isRow && !include.pages) {
      report.skipped += 1;
      continue;
    }
    if (isRow) {
      if (rowBatch.length && rowBatch[0].parent.id !== n.parent.id) await flushRows();
      rowBatch.push(n);
      continue;
    }
    await flushRows();
    client ??= clientFor(job);
    const idx = await writeIndex(job);
    if (await keptLocally(job, n)) {
      report.kept += 1;
      continue;
    }
    try {
      if (n.kind === 'database') await writeDatabase(client, job, idx, n, report);
      else {
        const content = await pageBlocks(client, job, idx, n, report);
        await savePage(job, n, await placement(job, idx, n), (n.title || 'Untitled').slice(0, 500), content, report);
        report.pages += 1;
      }
    } catch (e) {
      // Token revocado o límite de Notion: corta (o espera) el job entero.
      if (e instanceof ImportRetryError || (e instanceof ImportError && e.code === 'unauthorized')) throw e;
      report.failed += 1;
      pushError(report, `${n.title || 'Untitled'}: ${e instanceof ImportError ? e.code : 'internal_error'}`);
    }
  }
  await flushRows();
}

/** Al cerrar el job: suelta el índice en memoria. */
export async function cleanupNotionApi(job: ImportJob): Promise<void> {
  indexCache.delete(job.id);
}
