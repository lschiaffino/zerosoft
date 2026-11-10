/**
 * Docs ↔ Notion en dos vías, para migrar de a poco (Docs › Ajustes ›
 * Integraciones › Notion). Server-only.
 *
 * Conexión: OAuth de una integración pública de Notion ("Conectar con
 * Notion"; la persona elige en Notion qué páginas y bases comparte) o el
 * token de una integración interna (self-host, pruebas). Directo contra la
 * API de Notion: sin intermediarios que guarden los datos. El token va
 * cifrado (lib/secret-box) y nunca vuelve al navegador ni al registro.
 *
 * Flujo (todo en el cron de cada minuto, con claim por conexión en
 * claimed_until; "Sincronizar ahora" corre lo mismo con el mismo claim):
 *   1. descubrir: búsqueda paginada de lo compartido → notion_sync_items
 *      (mapa persistente Notion ↔ Docs; reusa lo que ya trajo el import de
 *      una vez). Reanudable: el cursor queda guardado.
 *   2. cola de Docs → Notion (notion_sync_outbox): cada guardado en Docs de
 *      una página sincronizada (o una subpágina nueva) la encola; reintentos
 *      con espera creciente.
 *   3. ítems pendientes (nuevos o editados en Notion), padres antes que
 *      hijas: lib/notion-sync-pages.ts los fusiona bloque por bloque.
 *   4. sondeo de last_edited_time (cada 2 min, o 10 si llegan webhooks) y
 *      webhooks de Notion como aviso (nunca se confía en su contenido: se
 *      vuelve a leer de la API).
 * A 3 pedidos por segundo como mucho (el límite de Notion) y, ante un 429,
 * se espera lo que pide Notion.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { getDb, type DocsPageRow } from './db';
import { open, seal } from './secret-box';
import { getExternalId, ImportError, ImportRetryError } from './import-jobs';
import { normalizeNotionId, pageTitle, stableId, type NBlock, type NDatabase, type NList, type NPage, type NParent } from './notion-api';
import { notionFakeAllowed } from './notion-api-fake';
import { NOTION_API_SOURCE } from './docs-notion-api-import';
import {
  getItem,
  insertItem,
  itemByLocal,
  loadIdIndex,
  logSync,
  makeRun,
  notionClientFor,
  NOTION_SYNC_DIRECTIONS,
  saveItem,
  timeLeft,
  type ConnectionRow,
  type ItemRow,
  type NotionPerson,
  type NotionSyncDirection,
  type Run,
} from './notion-sync-core';
import { createRemotePage, syncDatabase, syncPage, syncRowBody, type SyncOutcome } from './notion-sync-pages';

export { asNotionSync, fromNotionSync, setNotionSyncClientFactory, type NotionSyncDirection } from './notion-sync-core';

const POLL_MS = 2 * 60_000;
const POLL_WEBHOOK_MS = 10 * 60_000;
const OUTBOX_DEBOUNCE_MS = 5_000;
const MAX_ATTEMPTS = 6;
/** Ítems ya sincronizados que se revisan por sondeo (lo borrado en Notion no aparece en la búsqueda). */
const RECHECK_PER_POLL = 6;

export class NotionSyncError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

// ---------- OAuth ----------

export const NOTION_FAKE_CLIENT_ID = 'fake-client';

function clientId(): string {
  return process.env.NOTION_CLIENT_ID || (notionFakeAllowed() ? NOTION_FAKE_CLIENT_ID : '');
}

function clientSecret(): string {
  return process.env.NOTION_CLIENT_SECRET || (notionFakeAllowed() ? 'fake-secret' : '');
}

/** ¿Hay integración pública configurada (NOTION_CLIENT_ID y NOTION_CLIENT_SECRET)? */
export function notionOAuthConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

export function notionRedirectUri(): string {
  if (process.env.NOTION_REDIRECT_URI) return process.env.NOTION_REDIRECT_URI;
  return `${(process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '')}/api/integrations/notion/callback`;
}

export function notionAuthUrl(state: string): string {
  const u = new URL('https://api.notion.com/v1/oauth/authorize');
  u.searchParams.set('client_id', clientId());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('owner', 'user');
  u.searchParams.set('redirect_uri', notionRedirectUri());
  u.searchParams.set('state', state);
  return u.toString();
}

export interface NotionTokenResponse {
  access_token: string;
  refresh_token?: string | null;
  bot_id?: string;
  workspace_id?: string;
  workspace_name?: string | null;
}

type TokenFetch = (url: string, init: RequestInit) => Promise<Response>;
let tokenFetch: TokenFetch | null = null;

/** Solo tests: fetch del canje del código. */
export function setNotionTokenFetch(f: TokenFetch | null): void {
  tokenFetch = f;
}

/** Cambia el código de OAuth por el token (POST /v1/oauth/token con Basic client_id:secret). */
export async function exchangeNotionCode(code: string): Promise<NotionTokenResponse> {
  const doFetch: TokenFetch =
    tokenFetch ?? (notionFakeAllowed() && clientId() === NOTION_FAKE_CLIENT_ID ? (await import('./notion-sync-fake')).notionSyncFakeFetch() : (url, init) => fetch(url, init));
  const res = await doFetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64')}`,
      'content-type': 'application/json',
      'notion-version': '2022-06-28',
    },
    body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: notionRedirectUri() }),
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  }).catch(() => null);
  if (!res?.ok) throw new NotionSyncError('oauth_failed');
  const data = (await res.json().catch(() => null)) as NotionTokenResponse | null;
  if (!data?.access_token) throw new NotionSyncError('oauth_failed');
  return data;
}

// ---------- Conexión ----------

export async function getConnection(ws: string): Promise<ConnectionRow | null> {
  return ((await getDb().prepare('SELECT * FROM notion_sync_connections WHERE workspace_id = ?').get(ws)) as ConnectionRow | undefined) ?? null;
}

async function listNotionUsers(run: Pick<Run, 'client'>): Promise<NotionPerson[]> {
  const out: NotionPerson[] = [];
  let next: string | null = null;
  for (let i = 0; i < 10; i++) {
    const res: NList<{ id: string; type?: string; name?: string | null; person?: { email?: string } }> = await run.client.get(
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

/**
 * Conecta (o reconecta) el workspace. Valida el token contra Notion antes de
 * guardarlo. Reconectar el mismo workspace de Notion conserva el mapa: nada
 * se duplica.
 */
export async function connectNotion(
  ws: string,
  personId: string,
  input: { kind: 'oauth' | 'token'; token: string; refreshToken?: string | null; botId?: string | null; notionWorkspaceId?: string | null; workspaceName?: string | null },
): Promise<ConnectionRow> {
  const token = input.token.trim();
  if (!token || token.length > 500 || /\s/.test(token)) throw new NotionSyncError('invalid_token');
  const client = notionClientFor(token);
  let me: { id?: string; name?: string; bot?: { workspace_name?: string | null } };
  try {
    me = await client.get('/users/me');
  } catch (e) {
    if (e instanceof ImportError && e.code === 'unauthorized') throw new NotionSyncError('invalid_token');
    throw new NotionSyncError('notion_unreachable', 502);
  }
  let users: NotionPerson[] = [];
  try {
    users = await listNotionUsers({ client });
  } catch {
    // Sin "leer información de usuarios": las personas van como texto.
  }
  const now = new Date().toISOString();
  const name = (input.workspaceName || me.bot?.workspace_name || me.name || 'Notion').slice(0, 200);
  const botId = input.botId ?? me.id ?? null;
  await getDb()
    .prepare(
      `INSERT INTO notion_sync_connections (workspace_id, kind, token, refresh_token, bot_id, notion_workspace_id, notion_workspace_name, direction, paused, status,
         error, users, discover_cursor, poll_since, next_poll_at, claimed_until, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'two_way', 0, 'discovering', NULL, ?, NULL, NULL, ?, NULL, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET kind = excluded.kind, token = excluded.token, refresh_token = excluded.refresh_token,
         bot_id = excluded.bot_id, notion_workspace_id = excluded.notion_workspace_id, notion_workspace_name = excluded.notion_workspace_name,
         status = 'discovering', error = NULL, users = excluded.users, discover_cursor = NULL, next_poll_at = excluded.next_poll_at,
         paused = 0, created_by = excluded.created_by, updated_at = excluded.updated_at`,
    )
    .run(
      ws,
      input.kind,
      seal(token),
      input.refreshToken ? seal(input.refreshToken) : null,
      botId ? normalizeNotionId(botId) : null,
      input.notionWorkspaceId ? normalizeNotionId(input.notionWorkspaceId) : null,
      name,
      JSON.stringify(users),
      now,
      personId,
      now,
      now,
    );
  await logSync(ws, 'sys', 'connected', name);
  return (await getConnection(ws))!;
}

export async function disconnectNotion(ws: string): Promise<boolean> {
  const db = getDb();
  const res = await db.prepare('DELETE FROM notion_sync_connections WHERE workspace_id = ?').run(ws);
  await db.prepare('DELETE FROM notion_sync_outbox WHERE workspace_id = ?').run(ws);
  // El mapa queda: reconectar no duplica páginas.
  if (res.changes) await logSync(ws, 'sys', 'disconnected');
  return res.changes > 0;
}

export async function updateNotionSync(
  ws: string,
  patch: { direction?: unknown; paused?: unknown; roots?: unknown; teamspace_id?: unknown },
): Promise<void> {
  const conn = await getConnection(ws);
  if (!conn) throw new NotionSyncError('not_connected', 404);
  const db = getDb();
  const now = new Date().toISOString();
  if (patch.direction !== undefined) {
    if (!NOTION_SYNC_DIRECTIONS.includes(patch.direction as NotionSyncDirection)) throw new NotionSyncError('invalid_direction');
    await db.prepare('UPDATE notion_sync_connections SET direction = ?, updated_at = ? WHERE workspace_id = ?').run(patch.direction as string, now, ws);
    await logSync(ws, 'sys', `direction_${patch.direction as string}`);
  }
  if (patch.paused !== undefined) {
    const paused = patch.paused === true;
    await db.prepare('UPDATE notion_sync_connections SET paused = ?, next_poll_at = ?, updated_at = ? WHERE workspace_id = ?').run(paused ? 1 : 0, now, now, ws);
    await logSync(ws, 'sys', paused ? 'paused' : 'resumed');
  }
  if (patch.teamspace_id !== undefined) {
    const id = typeof patch.teamspace_id === 'string' && patch.teamspace_id ? patch.teamspace_id : null;
    if (id) {
      const ts = (await db.prepare('SELECT workspace_id, deleted_at FROM docs_teamspaces WHERE id = ?').get(id)) as { workspace_id: string; deleted_at: string | null } | undefined;
      if (!ts || ts.workspace_id !== ws || ts.deleted_at) throw new NotionSyncError('invalid_teamspace');
    }
    await db.prepare('UPDATE notion_sync_connections SET teamspace_id = ?, updated_at = ? WHERE workspace_id = ?').run(id, now, ws);
  }
  if (Array.isArray(patch.roots)) {
    for (const r of patch.roots.slice(0, 500) as Array<{ id?: unknown; enabled?: unknown }>) {
      if (typeof r?.id !== 'string' || typeof r.enabled !== 'boolean') continue;
      const res = await db.prepare('UPDATE notion_sync_roots SET enabled = ? WHERE workspace_id = ? AND notion_id = ?').run(r.enabled ? 1 : 0, ws, r.id);
      // Encendida: lo que se había salteado vuelve a la cola.
      if (res.changes && r.enabled) {
        await db.prepare(`UPDATE notion_sync_items SET status = 'pending', due_at = NULL WHERE workspace_id = ? AND root_id = ? AND status = 'skipped'`).run(ws, r.id);
      }
    }
  }
}

// ---------- Estado para la pantalla ----------

export interface NotionSyncStatus {
  oauth: boolean;
  connection: null | {
    kind: 'oauth' | 'token';
    workspaceName: string;
    direction: NotionSyncDirection;
    paused: boolean;
    status: ConnectionRow['status'];
    error: string | null;
    lastSyncAt: string | null;
    createdAt: string;
    webhooks: boolean;
    teamspaceId: string | null;
  };
  progress: { total: number; synced: number; pending: number; errors: number; skipped: number };
  roots: Array<{ id: string; title: string; kind: string; enabled: boolean }>;
  log: Array<{ id: string; dir: string; action: string; title: string; pageId: string | null; detail: string | null; at: string }>;
  /** Solo para quien administra la instancia (ADMIN_EMAILS): el token de verificación del webhook. */
  webhookToken?: string | null;
  webhookWaiting?: boolean;
}

export async function getNotionSyncStatus(ws: string, opts: { operator?: boolean } = {}): Promise<NotionSyncStatus> {
  const db = getDb();
  const conn = await getConnection(ws);
  const counts = (await db
    .prepare(`SELECT status, COUNT(*) AS n FROM notion_sync_items WHERE workspace_id = ? GROUP BY status`)
    .all(ws)) as Array<{ status: string; n: number }>;
  const by = (s: string) => Number(counts.find((c) => c.status === s)?.n ?? 0);
  const roots = (await db
    .prepare('SELECT notion_id, title, kind, enabled FROM notion_sync_roots WHERE workspace_id = ? ORDER BY title COLLATE NOCASE LIMIT 200')
    .all(ws)) as Array<{ notion_id: string; title: string; kind: string; enabled: number }>;
  const log = (await db
    .prepare('SELECT id, dir, action, title, local_page_id, detail, created_at FROM notion_sync_log WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 60')
    .all(ws)) as Array<{ id: string; dir: string; action: string; title: string; local_page_id: string | null; detail: string | null; created_at: string }>;
  return {
    oauth: notionOAuthConfigured(),
    connection: conn
      ? {
          kind: conn.kind,
          workspaceName: conn.notion_workspace_name,
          direction: conn.direction,
          paused: conn.paused === 1,
          status: conn.status,
          error: conn.error,
          lastSyncAt: conn.last_sync_at,
          createdAt: conn.created_at,
          webhooks: Boolean(conn.webhook_at && Date.now() - Date.parse(conn.webhook_at) < 24 * 3600_000),
          teamspaceId: conn.teamspace_id,
        }
      : null,
    progress: { total: counts.reduce((a, c) => a + Number(c.n), 0) - by('gone'), synced: by('synced'), pending: by('pending'), errors: by('error'), skipped: by('skipped') },
    roots: roots.map((r) => ({ id: r.notion_id, title: r.title, kind: r.kind, enabled: r.enabled === 1 })),
    log: log.map((l) => ({ id: l.id, dir: l.dir, action: l.action, title: l.title, pageId: l.local_page_id, detail: l.detail, at: l.created_at })),
    ...(opts.operator ? { webhookToken: await pendingWebhookToken(), webhookWaiting: await webhookWindowOpen() } : {}),
  };
}

// ---------- Cola de Docs → Notion ----------

/**
 * Un guardado en Docs (contenido, título, papelera, subpágina nueva,
 * comentario). Barato y nunca falla: si el workspace tiene Notion conectado
 * con envío hacia allá, la página entra a la cola. Lo que escribe la propia
 * sincronización no entra (sin bucles).
 */
export async function notionSyncLocalChange(ws: string, pageId: string): Promise<void> {
  try {
    const { fromNotionSync } = await import('./notion-sync-core');
    if (fromNotionSync()) return;
    const conn = (await getDb().prepare('SELECT direction FROM notion_sync_connections WHERE workspace_id = ?').get(ws)) as { direction: string } | undefined;
    if (!conn || conn.direction === 'import') return;
    const now = Date.now();
    await getDb()
      .prepare(
        `INSERT INTO notion_sync_outbox (workspace_id, local_page_id, due_at, dirty, attempts, created_at) VALUES (?, ?, ?, 0, 0, ?)
         ON CONFLICT(workspace_id, local_page_id) DO UPDATE SET dirty = 1`,
      )
      .run(ws, pageId, new Date(now + OUTBOX_DEBOUNCE_MS).toISOString(), new Date(now).toISOString());
  } catch {
    /* la sincronización es un extra: el guardado ya quedó */
  }
}

// ---------- Descubrir y sondear ----------

/** Página dentro de un bloque (columna, toggle): sube hasta la página o base que la contiene. */
async function resolveParent(run: Run, parent: NParent): Promise<{ id: string | null; kind: string | null }> {
  let p: NParent | undefined = parent;
  for (let i = 0; i < 6 && p; i++) {
    if (p.type === 'workspace') return { id: null, kind: null };
    if (p.type === 'page_id') return { id: normalizeNotionId(p.page_id), kind: 'page' };
    if (p.type === 'database_id') return { id: normalizeNotionId(p.database_id), kind: 'database' };
    try {
      const b: NBlock = await run.client.get(`/blocks/${encodeURIComponent(p.block_id)}`);
      p = b.parent;
    } catch (e) {
      if (e instanceof ImportRetryError || (e instanceof ImportError && e.code === 'unauthorized')) throw e;
      break;
    }
  }
  return { id: null, kind: null };
}

/** Lo que trajo la búsqueda → mapa (nuevo o pendiente si cambió en Notion). Devuelve si era nuevo. */
async function stage(run: Run, o: NPage | NDatabase): Promise<boolean> {
  if (o.object !== 'page' && o.object !== 'database') return false;
  const nid = normalizeNotionId(o.id);
  const existing = await getItem(run.ws, nid);
  const archived = Boolean(o.archived || o.in_trash);
  if (existing) {
    if (existing.synced_edited !== o.last_edited_time && existing.status !== 'pending') {
      await saveItem(run.ws, nid, { status: existing.status === 'skipped' ? 'skipped' : 'pending', notion_edited: o.last_edited_time, due_at: null, attempts: 0 });
      // Fila editada: sus propiedades las sincroniza la base.
      if (existing.kind === 'row' && existing.parent_notion_id) {
        await getDb()
          .prepare(`UPDATE notion_sync_items SET status = 'pending', due_at = NULL WHERE workspace_id = ? AND notion_id = ? AND status = 'synced'`)
          .run(run.ws, existing.parent_notion_id);
      }
    }
    return false;
  }
  if (archived) return false;
  const kind = o.object === 'database' ? 'database' : o.parent.type === 'database_id' ? 'row' : 'page';
  const parent = await resolveParent(run, o.parent);
  const parentItem = parent.id ? await getItem(run.ws, parent.id) : null;
  let localPageId: string | null = null;
  let rowId: string | null = null;
  if (kind === 'row') {
    rowId = (await getExternalId(run.ws, NOTION_API_SOURCE, 'row', nid)) ?? stableId(nid, 'row');
  } else {
    // Ya traída por el import de una vez (y sigue en Docs): se reusa esa página.
    const prev = await getExternalId(run.ws, NOTION_API_SOURCE, 'page', nid);
    const alive = prev ? await getDb().prepare('SELECT id FROM docs_pages WHERE id = ? AND user_id = ?').get(prev, run.ws) : null;
    localPageId = alive ? prev : crypto.randomUUID();
  }
  await insertItem({
    workspace_id: run.ws,
    notion_id: nid,
    kind,
    title: pageTitle(o).slice(0, 500),
    parent_notion_id: parent.id,
    parent_kind: parent.kind,
    root_id: parentItem ? (parentItem.root_id ?? parentItem.notion_id) : nid,
    depth: parentItem ? parentItem.depth + 1 : 0,
    local_page_id: localPageId,
    row_id: rowId,
    notion_edited: o.last_edited_time,
    synced_edited: null,
    local_synced_at: null,
    state: null,
    status: 'pending',
  });
  return true;
}

/** Raíz y profundidad de cada ítem (padres antes que hijas) y la lista de raíces. */
export async function refreshTree(ws: string): Promise<void> {
  const db = getDb();
  const rows = (await db.prepare(`SELECT notion_id, parent_notion_id, root_id, depth, kind, title FROM notion_sync_items WHERE workspace_id = ? AND status != 'gone'`).all(ws)) as Array<{
    notion_id: string;
    parent_notion_id: string | null;
    root_id: string | null;
    depth: number;
    kind: string;
    title: string;
  }>;
  const byId = new Map(rows.map((r) => [r.notion_id, r]));
  const now = new Date().toISOString();
  for (const r of rows) {
    let depth = 0;
    let cur = r;
    const seen = new Set<string>([r.notion_id]);
    while (cur.parent_notion_id && byId.has(cur.parent_notion_id) && !seen.has(cur.parent_notion_id)) {
      cur = byId.get(cur.parent_notion_id)!;
      seen.add(cur.notion_id);
      depth++;
    }
    if (cur.notion_id !== r.root_id || depth !== r.depth) {
      await db.prepare('UPDATE notion_sync_items SET root_id = ?, depth = ? WHERE workspace_id = ? AND notion_id = ?').run(cur.notion_id, depth, ws, r.notion_id);
    }
    if (cur.notion_id === r.notion_id && r.kind !== 'row') {
      await db
        .prepare('INSERT INTO notion_sync_roots (workspace_id, notion_id, kind, title, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(workspace_id, notion_id) DO UPDATE SET title = excluded.title')
        .run(ws, r.notion_id, r.kind, r.title || 'Untitled', now);
    }
  }
  // Raíces que ya no lo son (ahora cuelgan de otra compartida).
  const roots = (await db.prepare('SELECT notion_id FROM notion_sync_roots WHERE workspace_id = ?').all(ws)) as Array<{ notion_id: string }>;
  for (const r of roots) {
    const it = byId.get(r.notion_id);
    if (!it || (it.parent_notion_id && byId.has(it.parent_notion_id))) await db.prepare('DELETE FROM notion_sync_roots WHERE workspace_id = ? AND notion_id = ?').run(ws, r.notion_id);
  }
}

async function discover(run: Run): Promise<void> {
  const db = getDb();
  let cursor = run.conn.discover_cursor;
  if (!cursor && !run.conn.poll_since) {
    await db.prepare('UPDATE notion_sync_connections SET poll_since = ? WHERE workspace_id = ?').run(new Date().toISOString(), run.ws);
  }
  while (timeLeft(run)) {
    const res: NList<NPage | NDatabase> = await run.client.post('/search', { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    for (const o of res.results ?? []) await stage(run, o);
    cursor = res.has_more ? res.next_cursor : null;
    await db.prepare('UPDATE notion_sync_connections SET discover_cursor = ? WHERE workspace_id = ?').run(cursor, run.ws);
    if (!cursor) {
      await refreshTree(run.ws);
      await db
        .prepare(`UPDATE notion_sync_connections SET status = 'importing', next_poll_at = ?, updated_at = ? WHERE workspace_id = ?`)
        .run(new Date(Date.now() + POLL_MS).toISOString(), new Date().toISOString(), run.ws);
      run.conn.status = 'importing';
      const n = (await db.prepare('SELECT COUNT(*) AS n FROM notion_sync_items WHERE workspace_id = ?').get(run.ws)) as { n: number };
      await logSync(run.ws, 'sys', 'discovered', '', null, String(n.n));
      return;
    }
  }
}

/** Lo editado en Notion desde el último sondeo (búsqueda ordenada por last_edited_time). */
async function poll(run: Run): Promise<void> {
  const db = getDb();
  // Notion redondea last_edited_time al minuto: margen de dos.
  const since = run.conn.poll_since ? Date.parse(run.conn.poll_since) - 2 * 60_000 : 0;
  let newest = run.conn.poll_since ?? new Date(0).toISOString();
  let cursor: string | null = null;
  let added = false;
  for (let i = 0; i < 3 && timeLeft(run); i++) {
    const res: NList<NPage | NDatabase> = await run.client.post('/search', {
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      page_size: 50,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    let stop = false;
    for (const o of res.results ?? []) {
      if (Date.parse(o.last_edited_time) < since) {
        stop = true;
        break;
      }
      if (o.last_edited_time > newest) newest = o.last_edited_time;
      if (await stage(run, o)) added = true;
    }
    cursor = res.has_more ? res.next_cursor : null;
    if (stop || !cursor) break;
  }
  if (added) await refreshTree(run.ws);
  // Lo borrado o dejado de compartir en Notion no sale en la búsqueda: se revisan unos pocos por vez.
  const old = (await db
    .prepare(`SELECT notion_id, kind, synced_edited FROM notion_sync_items WHERE workspace_id = ? AND status = 'synced' AND kind != 'row' ORDER BY updated_at LIMIT ?`)
    .all(run.ws, RECHECK_PER_POLL)) as Array<{ notion_id: string; kind: string; synced_edited: string | null }>;
  for (const it of old) {
    if (!timeLeft(run)) break;
    try {
      const o: { archived?: boolean; in_trash?: boolean; last_edited_time: string } = await run.client.get(`/${it.kind === 'database' ? 'databases' : 'pages'}/${encodeURIComponent(it.notion_id)}`);
      if (o.archived || o.in_trash || o.last_edited_time !== it.synced_edited) await saveItem(run.ws, it.notion_id, { status: 'pending', due_at: null });
      else await saveItem(run.ws, it.notion_id, {});
      await db.prepare('UPDATE notion_sync_items SET updated_at = ? WHERE workspace_id = ? AND notion_id = ?').run(new Date().toISOString(), run.ws, it.notion_id);
    } catch (e) {
      if (e instanceof ImportError && (e.code === 'not_found' || e.code === 'restricted')) await saveItem(run.ws, it.notion_id, { status: 'pending', due_at: null });
      else throw e;
    }
  }
  const webhooks = run.conn.webhook_at && Date.now() - Date.parse(run.conn.webhook_at) < 24 * 3600_000;
  await db
    .prepare('UPDATE notion_sync_connections SET poll_since = ?, next_poll_at = ? WHERE workspace_id = ?')
    .run(newest, new Date(Date.now() + (webhooks ? POLL_WEBHOOK_MS : POLL_MS)).toISOString(), run.ws);
}

// ---------- Ítems y cola ----------

async function rootDisabled(run: Run, item: ItemRow): Promise<boolean> {
  return Boolean(item.root_id && run.disabledRoots.has(item.root_id));
}

async function syncItem(run: Run, item: ItemRow): Promise<SyncOutcome> {
  if (item.kind === 'database') return syncDatabase(run, item);
  if (item.kind === 'row') return syncRowBody(run, item);
  return syncPage(run, item);
}

function backoff(attempts: number): string {
  const mins = [1, 5, 30, 120, 360, 720][Math.min(attempts, 5)];
  return new Date(Date.now() + mins * 60_000).toISOString();
}

function errorCode(e: unknown): string {
  if (e instanceof ImportError) return e.code;
  if (e instanceof NotionSyncError) return e.code;
  return 'internal_error';
}

async function applyOutcome(run: Run, item: ItemRow, outcome: SyncOutcome): Promise<void> {
  if (outcome === 'later') {
    await saveItem(run.ws, item.notion_id, { due_at: new Date(Date.now() + 60_000).toISOString() });
    return;
  }
  await saveItem(run.ws, item.notion_id, { status: outcome, attempts: 0, due_at: null, ...(outcome === 'synced' ? { error: null } : {}) });
  if (outcome === 'gone') {
    run.ids.byNotion.delete(item.notion_id);
    if (item.row_id) run.ids.byRow.delete(item.row_id);
    else if (item.local_page_id) run.ids.byLocal.delete(item.local_page_id);
  }
}

async function failItem(run: Run, item: ItemRow, e: unknown): Promise<void> {
  if (e instanceof ImportRetryError || (e instanceof ImportError && e.code === 'unauthorized')) throw e;
  const attempts = item.attempts + 1;
  await saveItem(run.ws, item.notion_id, { attempts, status: attempts >= MAX_ATTEMPTS ? 'error' : 'pending', due_at: backoff(attempts), error: errorCode(e) });
  await logSync(run.ws, 'sys', 'error', item.title, item.local_page_id, errorCode(e));
  // eslint-disable-next-line no-console
  if (errorCode(e) === 'internal_error') console.error('[notion-sync] item failed', (e as Error)?.name ?? 'error', (e as Error)?.message?.slice(0, 200));
}

async function processItems(run: Run): Promise<void> {
  const db = getDb();
  for (let round = 0; round < 10 && timeLeft(run); round++) {
    const items = (await db
      .prepare(`SELECT * FROM notion_sync_items WHERE workspace_id = ? AND status = 'pending' AND (due_at IS NULL OR due_at <= ?) ORDER BY depth, created_at LIMIT 25`)
      .all(run.ws, new Date().toISOString())) as ItemRow[];
    if (!items.length) return;
    for (const item of items) {
      if (!timeLeft(run)) return;
      if (await rootDisabled(run, item)) {
        await saveItem(run.ws, item.notion_id, { status: 'skipped' });
        continue;
      }
      try {
        await applyOutcome(run, item, await syncItem(run, item));
      } catch (e) {
        await failItem(run, item, e);
      }
    }
  }
}

/** Una página de Docs que cambió: su par en Notion, o una página nueva allá si cuelga de una sincronizada. */
async function pushLocal(run: Run, pageId: string): Promise<void> {
  const item = await itemByLocal(run.ws, pageId);
  if (item) {
    if (item.status === 'skipped' || (await rootDisabled(run, item))) return;
    try {
      await applyOutcome(run, item, await syncItem(run, item));
    } catch (e) {
      await failItem(run, item, e);
    }
    return;
  }
  const row = (await getDb().prepare('SELECT * FROM docs_pages WHERE id = ? AND user_id = ?').get(pageId, run.ws)) as DocsPageRow | undefined;
  if (!row || row.archived === 1 || !row.parent_id) return;
  // Subpágina con acceso más cerrado que su padre: queda solo en Docs.
  if (row.inherit_shares === 0 || row.member_role) return;
  const parent = await itemByLocal(run.ws, row.parent_id);
  if (!parent || parent.kind !== 'page' || parent.status === 'skipped' || (await rootDisabled(run, parent))) return;
  const created = await createRemotePage(run, row, parent);
  if (!created) return;
  try {
    await applyOutcome(run, created, await syncItem(run, created));
  } catch (e) {
    await failItem(run, created, e);
  }
  // Subpáginas que ya tenía en Docs (se creó con hijas): a la cola también.
  const kids = (await getDb().prepare('SELECT id FROM docs_pages WHERE parent_id = ? AND user_id = ? AND archived = 0 LIMIT 50').all(row.id, run.ws)) as Array<{ id: string }>;
  for (const k of kids) await notionSyncLocalChange(run.ws, k.id);
}

async function processOutbox(run: Run): Promise<void> {
  const db = getDb();
  const due = (await db
    .prepare('SELECT local_page_id, attempts FROM notion_sync_outbox WHERE workspace_id = ? AND due_at <= ? ORDER BY due_at LIMIT 20')
    .all(run.ws, new Date().toISOString())) as Array<{ local_page_id: string; attempts: number }>;
  for (const d of due) {
    if (!timeLeft(run)) return;
    // Lo que se edite mientras se manda vuelve a marcarla (dirty) y sale en la vuelta siguiente.
    await db.prepare('UPDATE notion_sync_outbox SET dirty = 0 WHERE workspace_id = ? AND local_page_id = ?').run(run.ws, d.local_page_id);
    try {
      await pushLocal(run, d.local_page_id);
      const res = await db.prepare('DELETE FROM notion_sync_outbox WHERE workspace_id = ? AND local_page_id = ? AND dirty = 0').run(run.ws, d.local_page_id);
      if (!res.changes) {
        await db
          .prepare('UPDATE notion_sync_outbox SET dirty = 0, due_at = ? WHERE workspace_id = ? AND local_page_id = ?')
          .run(new Date(Date.now() + OUTBOX_DEBOUNCE_MS).toISOString(), run.ws, d.local_page_id);
      }
    } catch (e) {
      if (e instanceof ImportRetryError || (e instanceof ImportError && e.code === 'unauthorized')) throw e;
      const attempts = d.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await db.prepare('DELETE FROM notion_sync_outbox WHERE workspace_id = ? AND local_page_id = ?').run(run.ws, d.local_page_id);
      } else {
        await db
          .prepare('UPDATE notion_sync_outbox SET attempts = ?, due_at = ?, error = ? WHERE workspace_id = ? AND local_page_id = ?')
          .run(attempts, backoff(attempts), errorCode(e), run.ws, d.local_page_id);
      }
      await logSync(run.ws, 'sys', 'error', '', d.local_page_id, errorCode(e));
    }
  }
}

// ---------- Corridas ----------

async function claim(ws: string, budgetMs: number): Promise<ConnectionRow | null> {
  const now = new Date();
  const until = new Date(now.getTime() + budgetMs + 60_000).toISOString();
  const res = await getDb()
    .prepare('UPDATE notion_sync_connections SET claimed_until = ? WHERE workspace_id = ? AND (claimed_until IS NULL OR claimed_until < ?)')
    .run(until, ws, now.toISOString());
  if (!res.changes) return null;
  return getConnection(ws);
}

async function release(ws: string): Promise<void> {
  await getDb().prepare('UPDATE notion_sync_connections SET claimed_until = NULL WHERE workspace_id = ?').run(ws);
}

async function runConnection(conn: ConnectionRow, budgetMs: number): Promise<void> {
  const ws = conn.workspace_id;
  const db = getDb();
  try {
    const run = await makeRun(conn, budgetMs);
    if (run.conn.status === 'discovering') {
      await discover(run);
      run.ids = await loadIdIndex(ws);
    }
    if (run.conn.status !== 'discovering') {
      if (run.dirOut) await processOutbox(run);
      await processItems(run);
      const due = !run.conn.next_poll_at || Date.parse(run.conn.next_poll_at) <= Date.now();
      if (due && timeLeft(run)) await poll(run);
      const pending = (await db.prepare(`SELECT COUNT(*) AS n FROM notion_sync_items WHERE workspace_id = ? AND status = 'pending'`).get(ws)) as { n: number };
      const nextStatus = Number(pending.n) === 0 ? 'live' : run.conn.status === 'live' ? 'live' : 'importing';
      if (nextStatus === 'live' && run.conn.status === 'importing') await logSync(ws, 'sys', 'imported');
      await db.prepare('UPDATE notion_sync_connections SET status = ?, error = NULL, last_sync_at = ?, updated_at = ? WHERE workspace_id = ?').run(nextStatus, new Date().toISOString(), new Date().toISOString(), ws);
    }
  } catch (e) {
    if (e instanceof ImportRetryError) {
      // Límite de Notion: se espera lo que pidió.
      await db.prepare('UPDATE notion_sync_connections SET next_poll_at = ? WHERE workspace_id = ?').run(new Date(Date.now() + e.ms).toISOString(), ws);
      await logSync(ws, 'sys', 'rate_limited');
    } else if (e instanceof ImportError && e.code === 'unauthorized') {
      await db.prepare(`UPDATE notion_sync_connections SET status = 'error', error = 'unauthorized', updated_at = ? WHERE workspace_id = ?`).run(new Date().toISOString(), ws);
      await logSync(ws, 'sys', 'error', '', null, 'unauthorized');
    } else {
      await db.prepare('UPDATE notion_sync_connections SET error = ?, next_poll_at = ? WHERE workspace_id = ?').run(errorCode(e), new Date(Date.now() + POLL_MS).toISOString(), ws);
      await logSync(ws, 'sys', 'error', '', null, errorCode(e));
      // eslint-disable-next-line no-console
      console.error('[notion-sync] run failed', (e as Error)?.name ?? 'error', (e as Error)?.message?.slice(0, 200));
    }
  } finally {
    await release(ws).catch(() => undefined);
  }
}

/** Cron de cada minuto: conexiones con algo para hacer (claim por conexión). */
export async function runNotionSync(opts: { budgetMs?: number; limit?: number } = {}): Promise<number> {
  const start = Date.now();
  const budget = opts.budgetMs ?? 30_000;
  const now = new Date().toISOString();
  const due = (await getDb()
    .prepare(
      `SELECT c.workspace_id FROM notion_sync_connections c
       WHERE c.paused = 0 AND c.status != 'error' AND (c.claimed_until IS NULL OR c.claimed_until < ?)
         AND (c.status IN ('discovering', 'importing') OR c.next_poll_at IS NULL OR c.next_poll_at <= ?
           OR EXISTS (SELECT 1 FROM notion_sync_outbox o WHERE o.workspace_id = c.workspace_id AND o.due_at <= ?)
           OR EXISTS (SELECT 1 FROM notion_sync_items i WHERE i.workspace_id = c.workspace_id AND i.status = 'pending' AND (i.due_at IS NULL OR i.due_at <= ?)))
       ORDER BY c.next_poll_at LIMIT ?`,
    )
    .all(now, now, now, now, opts.limit ?? 10)) as Array<{ workspace_id: string }>;
  let done = 0;
  for (const d of due) {
    const left = budget - (Date.now() - start);
    if (left < 2_000) break;
    const conn = await claim(d.workspace_id, left);
    if (!conn) continue;
    await runConnection(conn, Math.min(left, 20_000));
    done++;
  }
  return done;
}

/** "Sincronizar ahora" (y el avance del import mientras la pantalla está abierta). false si ya corre otra. */
export async function syncNotionNow(ws: string, budgetMs = 8_000): Promise<boolean> {
  const conn = await claim(ws, budgetMs);
  if (!conn) return false;
  if (conn.paused === 1) {
    await release(ws);
    return true;
  }
  if (conn.status === 'error') {
    // Reintento a mano: vuelve a probar el token.
    await getDb().prepare(`UPDATE notion_sync_connections SET status = CASE WHEN discover_cursor IS NULL AND poll_since IS NULL THEN 'discovering' ELSE 'importing' END, error = NULL WHERE workspace_id = ?`).run(ws);
    conn.status = conn.poll_since ? 'importing' : 'discovering';
  }
  // A mano no se espera: la cola sale ya.
  await getDb().prepare('UPDATE notion_sync_outbox SET due_at = ? WHERE workspace_id = ? AND attempts = 0').run(new Date().toISOString(), ws);
  await runConnection({ ...conn, next_poll_at: conn.status === 'live' ? new Date(0).toISOString() : conn.next_poll_at }, budgetMs);
  return true;
}

// ---------- Webhooks ----------

/** Token de verificación del webhook de la integración pública (NOTION_WEBHOOK_SECRET o el que mandó Notion). */
async function webhookSecret(): Promise<string | null> {
  if (process.env.NOTION_WEBHOOK_SECRET) return process.env.NOTION_WEBHOOK_SECRET;
  const row = (await getDb().prepare(`SELECT token FROM notion_sync_webhook WHERE id = 'public'`).get()) as { token: string } | undefined;
  return row ? open(row.token) || null : null;
}

/** Para quien administra la instancia (ADMIN_EMAILS): el token que mandó Notion al verificar. */
export async function pendingWebhookToken(): Promise<string | null> {
  if (process.env.NOTION_WEBHOOK_SECRET) return null;
  return webhookSecret();
}

export async function clearWebhookToken(): Promise<void> {
  await getDb().prepare(`DELETE FROM notion_sync_webhook WHERE id = 'public'`).run();
}

const WEBHOOK_WINDOW_MS = 15 * 60_000;

/** Quien administra la instancia: "esperar el token de Notion" (15 minutos). Borra el anterior. */
export async function openWebhookWindow(): Promise<void> {
  const db = getDb();
  await db.prepare(`DELETE FROM notion_sync_webhook WHERE id IN ('public', 'window')`).run();
  await db.prepare(`INSERT INTO notion_sync_webhook (id, token, created_at) VALUES ('window', '', ?)`).run(new Date().toISOString());
}

/** ¿Hay una ventana abierta esperando el token? */
export async function webhookWindowOpen(): Promise<boolean> {
  const win = (await getDb().prepare(`SELECT created_at FROM notion_sync_webhook WHERE id = 'window'`).get()) as { created_at: string } | undefined;
  return Boolean(win && Date.now() - Date.parse(win.created_at) < WEBHOOK_WINDOW_MS);
}

export function verifyNotionSignature(raw: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST de Notion. La primera vez trae `verification_token` (queda guardado
 * cifrado para pegarlo en Notion, solo si no había uno). Los eventos van
 * firmados (X-Notion-Signature); son solo un aviso: marcan el ítem como
 * pendiente y adelantan el sondeo. Lo que importa se vuelve a leer de la API.
 */
export async function handleNotionWebhook(raw: string, signature: string | null): Promise<{ status: number; body: Record<string, unknown> }> {
  if (raw.length > 256 * 1024) return { status: 413, body: { error: 'too_large' } };
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { status: 400, body: { error: 'invalid_json' } };
  }
  if (typeof body.verification_token === 'string' && !signature) {
    // Solo mientras quien administra la instancia lo espera (ventana de 15 minutos abierta desde Ajustes) y una vez.
    if (!process.env.NOTION_WEBHOOK_SECRET && notionOAuthConfigured() && body.verification_token.length <= 200) {
      const db = getDb();
      const win = (await db.prepare(`SELECT created_at FROM notion_sync_webhook WHERE id = 'window'`).get()) as { created_at: string } | undefined;
      if (win && Date.now() - Date.parse(win.created_at) < WEBHOOK_WINDOW_MS) {
        const res = await db.prepare(`INSERT OR IGNORE INTO notion_sync_webhook (id, token, created_at) VALUES ('public', ?, ?)`).run(seal(body.verification_token), new Date().toISOString());
        if (res.changes) await db.prepare(`DELETE FROM notion_sync_webhook WHERE id = 'window'`).run();
      }
    }
    return { status: 200, body: { ok: true } };
  }
  const secret = await webhookSecret();
  if (!secret || !verifyNotionSignature(raw, signature, secret)) return { status: 401, body: { error: 'invalid_signature' } };
  const nws = typeof body.workspace_id === 'string' ? normalizeNotionId(body.workspace_id) : '';
  const entity = (body.entity ?? {}) as { id?: unknown };
  const data = (body.data ?? {}) as { parent?: { id?: unknown } };
  const ids = [entity.id, data.parent?.id].filter((x): x is string => typeof x === 'string').map(normalizeNotionId);
  if (!nws) return { status: 200, body: { ok: true } };
  const db = getDb();
  const conns = (await db.prepare('SELECT workspace_id FROM notion_sync_connections WHERE notion_workspace_id = ? AND paused = 0').all(nws)) as Array<{ workspace_id: string }>;
  const now = new Date().toISOString();
  for (const c of conns) {
    for (const id of ids) {
      await db
        .prepare(`UPDATE notion_sync_items SET status = 'pending', due_at = NULL WHERE workspace_id = ? AND notion_id = ? AND status IN ('synced', 'error')`)
        .run(c.workspace_id, id);
    }
    await db.prepare('UPDATE notion_sync_connections SET next_poll_at = ?, webhook_at = ? WHERE workspace_id = ?').run(now, now, c.workspace_id);
  }
  return { status: 200, body: { ok: true } };
}
