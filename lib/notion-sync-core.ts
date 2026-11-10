/**
 * Sincronización Docs ↔ Notion: piezas compartidas del motor (tipos de las
 * tablas, cliente, contexto de una corrida, ids y registro). Server-only.
 * El flujo está en lib/notion-sync.ts y la sincronización de cada página,
 * base y fila en lib/notion-sync-pages.ts.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { getDb } from './db';
import { open } from './secret-box';
import { createNotionClient, normalizeNotionId, type NotionClient, type NotionConvertContext } from './notion-api';
import { notionFakeAllowed } from './notion-api-fake';
import { isNotionSyncFakeToken, notionSyncFakeFetch } from './notion-sync-fake';
import { workspacePeople } from './crm-import';
import type { ReverseContext } from './notion-sync-convert';

export type NotionSyncDirection = 'two_way' | 'import' | 'to_notion';
export const NOTION_SYNC_DIRECTIONS: NotionSyncDirection[] = ['two_way', 'import', 'to_notion'];

export interface ConnectionRow {
  workspace_id: string;
  kind: 'oauth' | 'token';
  token: string;
  refresh_token: string | null;
  bot_id: string | null;
  notion_workspace_id: string | null;
  notion_workspace_name: string;
  direction: NotionSyncDirection;
  paused: number;
  teamspace_id: string | null;
  /** discovering → importing → live (o error). */
  status: 'discovering' | 'importing' | 'live' | 'error';
  error: string | null;
  users: string | null;
  discover_cursor: string | null;
  poll_since: string | null;
  next_poll_at: string | null;
  claimed_until: string | null;
  last_sync_at: string | null;
  webhook_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ItemKind = 'page' | 'database' | 'row';
export type ItemStatus = 'pending' | 'synced' | 'error' | 'skipped' | 'gone';

export interface ItemRow {
  workspace_id: string;
  notion_id: string;
  kind: ItemKind;
  title: string;
  parent_notion_id: string | null;
  parent_kind: string | null;
  root_id: string | null;
  depth: number;
  /** Página de Docs (de la página o de la base; en una fila, la de su base). */
  local_page_id: string | null;
  /** Solo filas: id de la fila dentro de la base. */
  row_id: string | null;
  notion_edited: string | null;
  synced_edited: string | null;
  local_synced_at: string | null;
  state: string | null;
  status: ItemStatus;
  attempts: number;
  error: string | null;
  due_at: string | null;
  claimed_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotionPerson {
  id: string;
  name: string;
  email: string;
}

// ---------- Cliente ----------

type ClientFactory = (token: string) => NotionClient;

const defaultFactory: ClientFactory = (token) =>
  notionFakeAllowed() && isNotionSyncFakeToken(token) ? createNotionClient(token, { fetch: notionSyncFakeFetch(), noThrottle: true }) : createNotionClient(token);

let factory: ClientFactory = defaultFactory;

/** Solo tests: cómo se crea el cliente (null vuelve al default). */
export function setNotionSyncClientFactory(f: ClientFactory | null): void {
  factory = f ?? defaultFactory;
}

export function notionClientFor(token: string): NotionClient {
  return factory(token);
}

// ---------- Origen de un guardado (prevención de bucles) ----------

const origin = new AsyncLocalStorage<boolean>();

/** Corre `fn` marcando que lo que se guarde en Docs viene de Notion (no vuelve a la cola). */
export function asNotionSync<T>(fn: () => Promise<T>): Promise<T> {
  return origin.run(true, fn);
}

export function fromNotionSync(): boolean {
  return origin.getStore() === true;
}

// ---------- Registro ----------

export type LogDir = 'in' | 'out' | 'sys';

/** Registro visible (Ajustes › Integraciones › Notion). Nunca lleva tokens ni contenido. */
export async function logSync(ws: string, dir: LogDir, action: string, title = '', pageId: string | null = null, detail: string | null = null): Promise<void> {
  try {
    const db = getDb();
    await db
      .prepare('INSERT INTO notion_sync_log (id, workspace_id, dir, action, title, local_page_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), ws, dir, action.slice(0, 40), title.slice(0, 200), pageId, detail ? detail.slice(0, 300) : null, new Date().toISOString());
    // Se queda con las últimas 300 entradas.
    if (Math.random() < 0.1) {
      await db
        .prepare(
          `DELETE FROM notion_sync_log WHERE workspace_id = ? AND id NOT IN (SELECT id FROM notion_sync_log WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 300)`,
        )
        .run(ws, ws);
    }
  } catch {
    /* el registro es un extra */
  }
}

// ---------- Corrida ----------

export interface IdIndex {
  /** notion id → item */
  byNotion: Map<string, Pick<ItemRow, 'notion_id' | 'kind' | 'local_page_id' | 'row_id' | 'parent_notion_id'>>;
  /** página local → notion id (páginas y bases) */
  byLocal: Map<string, string>;
  /** fila local → notion id */
  byRow: Map<string, string>;
}

export interface Run {
  ws: string;
  conn: ConnectionRow;
  client: NotionClient;
  deadline: number;
  dirIn: boolean;
  dirOut: boolean;
  notionUsers: NotionPerson[];
  /** email → persona del workspace */
  people: Map<string, string>;
  /** persona del workspace → email */
  emails: Map<string, string>;
  ids: IdIndex;
  /** Raíces apagadas. */
  disabledRoots: Set<string>;
  /** Pedidos que cambiaron algo en Notion en esta corrida. */
  writes: number;
}

export async function loadIdIndex(ws: string): Promise<IdIndex> {
  const rows = (await getDb()
    .prepare(`SELECT notion_id, kind, local_page_id, row_id, parent_notion_id FROM notion_sync_items WHERE workspace_id = ? AND status != 'gone'`)
    .all(ws)) as Array<Pick<ItemRow, 'notion_id' | 'kind' | 'local_page_id' | 'row_id' | 'parent_notion_id'>>;
  const idx: IdIndex = { byNotion: new Map(), byLocal: new Map(), byRow: new Map() };
  for (const r of rows) {
    idx.byNotion.set(r.notion_id, r);
    if (r.kind === 'row' && r.row_id) idx.byRow.set(r.row_id, r.notion_id);
    else if (r.local_page_id) idx.byLocal.set(r.local_page_id, r.notion_id);
  }
  return idx;
}

export function indexItem(idx: IdIndex, r: Pick<ItemRow, 'notion_id' | 'kind' | 'local_page_id' | 'row_id' | 'parent_notion_id'>): void {
  idx.byNotion.set(r.notion_id, r);
  if (r.kind === 'row' && r.row_id) idx.byRow.set(r.row_id, r.notion_id);
  else if (r.local_page_id) idx.byLocal.set(r.local_page_id, r.notion_id);
}

export async function makeRun(conn: ConnectionRow, budgetMs: number): Promise<Run> {
  const ws = conn.workspace_id;
  let notionUsers: NotionPerson[] = [];
  try {
    notionUsers = conn.users ? (JSON.parse(conn.users) as NotionPerson[]) : [];
  } catch {
    notionUsers = [];
  }
  const people = new Map<string, string>();
  const emails = new Map<string, string>();
  for (const p of await workspacePeople(ws)) {
    if (!p.email) continue;
    people.set(p.email.toLowerCase(), p.id);
    emails.set(p.id, p.email.toLowerCase());
  }
  const roots = (await getDb().prepare('SELECT notion_id FROM notion_sync_roots WHERE workspace_id = ? AND enabled = 0').all(ws)) as Array<{ notion_id: string }>;
  return {
    ws,
    conn,
    client: notionClientFor(open(conn.token)),
    deadline: Date.now() + budgetMs,
    dirIn: conn.direction !== 'to_notion',
    dirOut: conn.direction !== 'import',
    notionUsers,
    people,
    emails,
    ids: await loadIdIndex(ws),
    disabledRoots: new Set(roots.map((r) => r.notion_id)),
    writes: 0,
  };
}

export function timeLeft(run: Run): boolean {
  return Date.now() < run.deadline;
}

/** Contexto de Notion → Docs: links y menciones a páginas, filas y personas sincronizadas. */
export function forwardContext(run: Run): NotionConvertContext {
  return {
    pageFor(notionId) {
      const it = run.ids.byNotion.get(normalizeNotionId(notionId));
      if (!it) return null;
      if (it.kind === 'row') {
        const parent = it.parent_notion_id ? run.ids.byNotion.get(it.parent_notion_id) : undefined;
        return parent?.local_page_id && it.row_id ? { pageId: parent.local_page_id, rowId: it.row_id } : null;
      }
      return it.local_page_id ? { pageId: it.local_page_id } : null;
    },
    userName: (id) => run.notionUsers.find((u) => u.id === normalizeNotionId(id))?.name ?? null,
  };
}

/** Contexto de Docs → Notion: páginas, filas y personas. */
export function reverseContext(run: Run): ReverseContext & { notionUserFor(personId: string): string | null; notionRowFor(rowId: string): string | null } {
  return {
    notionIdFor(localPageId, rowId) {
      if (rowId) return run.ids.byRow.get(rowId) ?? null;
      return run.ids.byLocal.get(localPageId) ?? null;
    },
    notionUserFor(personId) {
      const email = run.emails.get(personId);
      return email ? (run.notionUsers.find((u) => u.email === email)?.id ?? null) : null;
    },
    notionRowFor: (rowId) => run.ids.byRow.get(rowId) ?? null,
  };
}

export async function getItem(ws: string, notionId: string): Promise<ItemRow | null> {
  return ((await getDb().prepare('SELECT * FROM notion_sync_items WHERE workspace_id = ? AND notion_id = ?').get(ws, notionId)) as ItemRow | undefined) ?? null;
}

export async function itemByLocal(ws: string, pageId: string): Promise<ItemRow | null> {
  return (
    ((await getDb()
      .prepare(`SELECT * FROM notion_sync_items WHERE workspace_id = ? AND local_page_id = ? AND kind IN ('page', 'database') AND status != 'gone' ORDER BY created_at LIMIT 1`)
      .get(ws, pageId)) as ItemRow | undefined) ?? null
  );
}

export async function saveItem(ws: string, notionId: string, fields: Partial<ItemRow>): Promise<void> {
  const keys = Object.keys(fields).filter((k) => k !== 'workspace_id' && k !== 'notion_id');
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const args = keys.map((k) => (fields as Record<string, unknown>)[k] as string | number | null);
  await getDb()
    .prepare(`UPDATE notion_sync_items SET ${sets}, updated_at = ? WHERE workspace_id = ? AND notion_id = ?`)
    .run(...args, new Date().toISOString(), ws, notionId);
}

export async function insertItem(row: Omit<ItemRow, 'created_at' | 'updated_at' | 'attempts' | 'error' | 'due_at' | 'claimed_until'>): Promise<void> {
  const now = new Date().toISOString();
  await getDb()
    .prepare(
      `INSERT OR IGNORE INTO notion_sync_items (workspace_id, notion_id, kind, title, parent_notion_id, parent_kind, root_id, depth, local_page_id, row_id,
         notion_edited, synced_edited, local_synced_at, state, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.workspace_id,
      row.notion_id,
      row.kind,
      row.title,
      row.parent_notion_id,
      row.parent_kind,
      row.root_id,
      row.depth,
      row.local_page_id,
      row.row_id,
      row.notion_edited,
      row.synced_edited,
      row.local_synced_at,
      row.state,
      row.status,
      now,
      now,
    );
}

/** Errores de la API que quieren decir "eso ya no está (o ya no se comparte)". */
export function isGoneError(e: unknown): boolean {
  return e instanceof Error && 'code' in e && ((e as { code: string }).code === 'not_found' || (e as { code: string }).code === 'restricted');
}
