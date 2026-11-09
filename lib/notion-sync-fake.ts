/**
 * Notion falso con estado, para la sincronización de dos vías (tests y e2e;
 * NOTION_IMPORT_FAKE=1 con NODE_ENV=test o DEMO_MODE, nunca en producción
 * normal). Responde las mismas rutas y formas que la API real: leer y
 * escribir páginas, bases, filas, bloques (agregar con `after`, editar,
 * borrar), comentarios, subida de archivos, búsqueda ordenada por edición y
 * el canje del código de OAuth.
 *
 * Cada token "fake-notion-sync[-algo]" tiene su propio workspace en memoria
 * (globalThis: lo comparten todas las rutas del mismo proceso). Cualquier
 * otro token: 401.
 */
import type { NotionFetch } from './notion-api';

export const NOTION_SYNC_FAKE_PREFIX = 'fake-notion-sync';

export function isNotionSyncFakeToken(token: string): boolean {
  return token === NOTION_SYNC_FAKE_PREFIX || token.startsWith(`${NOTION_SYNC_FAKE_PREFIX}-`);
}

type Obj = Record<string, unknown>;

interface FakeBlock extends Obj {
  object: 'block';
  id: string;
  type: string;
  has_children: boolean;
  archived: boolean;
  in_trash: boolean;
  parent: Obj;
  created_time: string;
  last_edited_time: string;
}

interface FakeWorkspace {
  pages: Map<string, Obj>;
  databases: Map<string, Obj>;
  blocks: Map<string, FakeBlock>;
  /** Hijos (ids) de cada página o bloque, en orden. */
  children: Map<string, string[]>;
  comments: Obj[];
  uploads: Map<string, Obj>;
  users: Obj[];
  /** Pedidos recibidos (los tests cuentan escrituras). */
  log: Array<{ method: string; path: string }>;
  clock: number;
  seq: number;
}

const STORE_KEY = Symbol.for('zerosoft.notionSyncFake');

function store(): Map<string, FakeWorkspace> {
  const g = globalThis as unknown as Record<symbol, Map<string, FakeWorkspace>>;
  g[STORE_KEY] ??= new Map();
  return g[STORE_KEY];
}

export const SYNC_FAKE_IDS = {
  wiki: '5a000000-0000-4000-8000-000000000001',
  guide: '5a000000-0000-4000-8000-000000000002',
  tasks: '5a000000-0000-4000-8000-000000000003',
  rowA: '5a000000-0000-4000-8000-000000000004',
  rowB: '5a000000-0000-4000-8000-000000000005',
  ana: '5a000000-0000-4000-8000-0000000000aa',
  bo: '5a000000-0000-4000-8000-0000000000bb',
  notionWorkspace: '5a000000-0000-4000-8000-0000000000ff',
};

const norm = (id: string) => decodeURIComponent(id).replace(/-/g, '').toLowerCase();
const dashed = (hex: string) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;

function now(ws: FakeWorkspace): string {
  // Reloj propio que siempre avanza (dos ediciones seguidas no comparten hora).
  ws.clock = Math.max(Date.now(), ws.clock + 1000);
  return new Date(ws.clock).toISOString();
}

function newId(ws: FakeWorkspace): string {
  ws.seq += 1;
  const hex = `5b${ws.seq.toString(16).padStart(6, '0')}${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}${'0'.repeat(16)}`.slice(0, 32);
  return dashed(hex);
}

export const T = (content: string, annotations: Obj = {}, link?: string): Obj => ({
  type: 'text',
  text: { content, link: link ? { url: link } : null },
  annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default', ...annotations },
  plain_text: content,
  href: link ?? null,
});

/** Rich text de un pedido → el que devuelve Notion (con plain_text y annotations completas). */
function fullRichText(ws: FakeWorkspace, rt: unknown): Obj[] {
  return (Array.isArray(rt) ? rt : []).map((r: Obj) => {
    const ann = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default', ...((r.annotations as Obj) ?? {}) };
    if (r.type === 'mention') {
      const m = r.mention as Obj;
      if (m.type === 'page') {
        const id = String((m.page as Obj).id);
        const p = ws.pages.get(norm(id)) ?? ws.databases.get(norm(id));
        return { type: 'mention', mention: { type: 'page', page: { id: p ? String(p.id) : id } }, annotations: ann, plain_text: p ? titleOf(p) : 'Untitled', href: `https://www.notion.so/${norm(id)}` };
      }
      if (m.type === 'date') return { type: 'mention', mention: m, annotations: ann, plain_text: String((m.date as Obj).start), href: null };
      return { ...r, annotations: ann, plain_text: String(r.plain_text ?? '') };
    }
    if (r.type === 'equation') return { type: 'equation', equation: r.equation, annotations: ann, plain_text: String((r.equation as Obj).expression), href: null };
    const t = (r.text as Obj) ?? {};
    const link = (t.link as Obj | null)?.url as string | undefined;
    return { type: 'text', text: { content: String(t.content ?? ''), link: link ? { url: link } : null }, annotations: ann, plain_text: String(t.content ?? ''), href: link ?? null };
  });
}

function titleOf(p: Obj): string {
  if (p.object === 'database') return ((p.title as Obj[]) ?? []).map((r) => String(r.plain_text ?? '')).join('');
  const prop = Object.values((p.properties as Record<string, Obj>) ?? {}).find((v) => v.type === 'title');
  return ((prop?.title as Obj[]) ?? []).map((r) => String(r.plain_text ?? '')).join('');
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

const err = (status: number, code: string) => json({ object: 'error', status, code, message: code }, status);

function list(results: unknown[], cursor: string | null = null, pageSize = 100) {
  const start = cursor ? Number(cursor) : 0;
  const slice = results.slice(start, start + pageSize);
  const next = start + pageSize < results.length ? String(start + pageSize) : null;
  return { object: 'list', results: slice, has_more: Boolean(next), next_cursor: next };
}

// ---------- Semilla ----------

function seed(): FakeWorkspace {
  const ws: FakeWorkspace = { pages: new Map(), databases: new Map(), blocks: new Map(), children: new Map(), comments: [], uploads: new Map(), users: [], log: [], clock: Date.parse('2026-01-01T10:00:00.000Z'), seq: 0 };
  ws.users = [
    { object: 'user', id: SYNC_FAKE_IDS.ana, type: 'person', name: 'Ana Ruiz', person: { email: 'demo@zerosoft.ai' } },
    { object: 'user', id: SYNC_FAKE_IDS.bo, type: 'person', name: 'Bo Chen', person: { email: 'bo@acme.test' } },
  ];
  const at = '2026-01-01T10:00:00.000Z';
  const page = (id: string, title: string, parent: Obj, extra: Obj = {}) => {
    const p = { object: 'page', id, created_time: at, last_edited_time: at, archived: false, in_trash: false, icon: null, parent, properties: { title: { id: 'title', type: 'title', title: [T(title)] } }, url: `https://www.notion.so/${norm(id)}`, ...extra };
    ws.pages.set(norm(id), p);
    ws.children.set(norm(id), []);
    return p;
  };
  page(SYNC_FAKE_IDS.wiki, 'Team wiki', { type: 'workspace', workspace: true }, { icon: { type: 'emoji', emoji: '📗' } });
  page(SYNC_FAKE_IDS.guide, 'Style guide', { type: 'page_id', page_id: SYNC_FAKE_IDS.wiki });
  const db = {
    object: 'database', id: SYNC_FAKE_IDS.tasks, created_time: at, last_edited_time: at, archived: false, in_trash: false, is_inline: false,
    title: [T('Tasks')], description: [], icon: null, parent: { type: 'page_id', page_id: SYNC_FAKE_IDS.wiki },
    properties: {
      Name: { id: 'title', name: 'Name', type: 'title', title: {} },
      Status: { id: 'st', name: 'Status', type: 'select', select: { options: [{ id: 'o1', name: 'Todo', color: 'gray' }, { id: 'o2', name: 'Doing', color: 'blue' }, { id: 'o3', name: 'Done', color: 'green' }] } },
      Tags: { id: 'tg', name: 'Tags', type: 'multi_select', multi_select: { options: [{ name: 'docs' }, { name: 'sync' }] } },
      When: { id: 'wh', name: 'When', type: 'date', date: {} },
      Owner: { id: 'ow', name: 'Owner', type: 'people', people: {} },
      Points: { id: 'pt', name: 'Points', type: 'number', number: { format: 'number' } },
      Double: { id: 'db', name: 'Double', type: 'formula', formula: { expression: 'prop("Points") * 2' } },
      'Blocked by': { id: 'bl', name: 'Blocked by', type: 'relation', relation: { database_id: SYNC_FAKE_IDS.tasks } },
    },
  };
  ws.databases.set(norm(SYNC_FAKE_IDS.tasks), db);
  const row = (id: string, title: string, props: Obj) => {
    page(id, title, { type: 'database_id', database_id: SYNC_FAKE_IDS.tasks }, { properties: { Name: { id: 'title', type: 'title', title: [T(title)] }, ...props } });
  };
  row(SYNC_FAKE_IDS.rowA, 'Write the guide', {
    Status: { id: 'st', type: 'select', select: { id: 'o2', name: 'Doing', color: 'blue' } },
    Tags: { id: 'tg', type: 'multi_select', multi_select: [{ name: 'docs' }] },
    When: { id: 'wh', type: 'date', date: { start: '2026-11-03', end: '2026-11-05' } },
    Owner: { id: 'ow', type: 'people', people: [{ object: 'user', id: SYNC_FAKE_IDS.ana, name: 'Ana Ruiz', person: { email: 'demo@zerosoft.ai' } }] },
    Points: { id: 'pt', type: 'number', number: 3 },
    Double: { id: 'db', type: 'formula', formula: { type: 'number', number: 6 } },
    'Blocked by': { id: 'bl', type: 'relation', relation: [{ id: SYNC_FAKE_IDS.rowB }], has_more: false },
  });
  row(SYNC_FAKE_IDS.rowB, 'Review sync', {
    Status: { id: 'st', type: 'select', select: { id: 'o1', name: 'Todo', color: 'gray' } },
    Tags: { id: 'tg', type: 'multi_select', multi_select: [] },
    When: { id: 'wh', type: 'date', date: null },
    Owner: { id: 'ow', type: 'people', people: [] },
    Points: { id: 'pt', type: 'number', number: null },
    Double: { id: 'db', type: 'formula', formula: { type: 'number', number: 0 } },
    'Blocked by': { id: 'bl', type: 'relation', relation: [], has_more: false },
  });

  const add = (parent: string, type: string, data: Obj, kids: Array<[string, Obj, Array<[string, Obj]>?]> = []) => {
    const b = createBlock(ws, parent, { type, [type]: data }, at);
    for (const [kt, kd, grand] of kids) {
      const k = createBlock(ws, b.id, { type: kt, [kt]: kd }, at);
      for (const [gt, gd] of grand ?? []) createBlock(ws, k.id, { type: gt, [gt]: gd }, at);
    }
    return b;
  };
  add(SYNC_FAKE_IDS.wiki, 'heading_1', { rich_text: [T('Welcome')], is_toggleable: false, color: 'default' });
  add(SYNC_FAKE_IDS.wiki, 'paragraph', { rich_text: [T('Read the '), T('style guide', { bold: true }), T(' first.')], color: 'default' });
  add(SYNC_FAKE_IDS.wiki, 'toggle', { rich_text: [T('FAQ')], color: 'default' }, [['paragraph', { rich_text: [T('Ask in the team channel.')], color: 'default' }]]);
  add(SYNC_FAKE_IDS.wiki, 'callout', { rich_text: [T('Be kind')], icon: { type: 'emoji', emoji: '💡' }, color: 'yellow_background' });
  add(SYNC_FAKE_IDS.wiki, 'code', { rich_text: [T('npm run dev')], language: 'bash', caption: [] });
  add(SYNC_FAKE_IDS.wiki, 'to_do', { rich_text: [T('Sign the guide')], checked: false, color: 'default' });
  add(SYNC_FAKE_IDS.wiki, 'table', { table_width: 2, has_column_header: true, has_row_header: false }, [
    ['table_row', { cells: [[T('Team')], [T('Lead')]] }],
    ['table_row', { cells: [[T('Docs')], [T('Ana')]] }],
  ]);
  add(SYNC_FAKE_IDS.wiki, 'column_list', {}, [
    ['column', {}, [['paragraph', { rich_text: [T('Left')], color: 'default' }]]],
    ['column', {}, [['paragraph', { rich_text: [T('Right')], color: 'default' }]]],
  ]);
  add(SYNC_FAKE_IDS.wiki, 'image', { type: 'file', file: { url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/fake/logo.png?X-Amz-Signature=1', expiry_time: '2099-01-01T00:00:00.000Z' }, caption: [T('Logo')] });
  add(SYNC_FAKE_IDS.wiki, 'equation', { expression: 'a^2 + b^2 = c^2' });
  add(SYNC_FAKE_IDS.wiki, 'child_page', { title: 'Style guide' });
  fixChildId(ws, SYNC_FAKE_IDS.wiki, SYNC_FAKE_IDS.guide);
  add(SYNC_FAKE_IDS.wiki, 'child_database', { title: 'Tasks' });
  fixChildId(ws, SYNC_FAKE_IDS.wiki, SYNC_FAKE_IDS.tasks);
  add(SYNC_FAKE_IDS.guide, 'paragraph', { rich_text: [T('Short sentences. Plain words.')], color: 'default' });
  add(SYNC_FAKE_IDS.rowA, 'paragraph', { rich_text: [T('Draft in Docs, review in Notion.')], color: 'default' });
  ws.comments.push({
    object: 'comment', id: '5c000000-0000-4000-8000-000000000001', discussion_id: '5d000000-0000-4000-8000-000000000001',
    parent: { type: 'page_id', page_id: SYNC_FAKE_IDS.wiki }, created_time: at, last_edited_time: at,
    created_by: { object: 'user', id: SYNC_FAKE_IDS.bo }, rich_text: [T('Looks good to me')],
  });
  return ws;
}

/** child_page / child_database: el bloque tiene el id de la página o la base. */
function fixChildId(ws: FakeWorkspace, parent: string, id: string) {
  const kids = ws.children.get(norm(parent))!;
  const old = kids[kids.length - 1];
  const b = ws.blocks.get(old)!;
  ws.blocks.delete(old);
  b.id = id;
  ws.blocks.set(norm(id), b);
  kids[kids.length - 1] = norm(id);
}

function parentRef(ws: FakeWorkspace, parentId: string): Obj {
  const key = norm(parentId);
  if (ws.pages.has(key)) return { type: 'page_id', page_id: String(ws.pages.get(key)!.id) };
  return { type: 'block_id', block_id: String(ws.blocks.get(key)?.id ?? parentId) };
}

/** Crea un bloque (y sus hijos del pedido) debajo de `parent`, después de `after` o al final. */
function createBlock(ws: FakeWorkspace, parent: string, req: Obj, at?: string, after?: string | null): FakeBlock {
  const type = String(req.type ?? Object.keys(req).find((k) => k !== 'object' && k !== 'type'));
  const data = { ...((req[type] as Obj) ?? {}) };
  const kids = (data.children as Obj[] | undefined) ?? [];
  delete data.children;
  if ('rich_text' in data) data.rich_text = fullRichText(ws, data.rich_text);
  if ('caption' in data) data.caption = fullRichText(ws, data.caption);
  if (type === 'table_row') data.cells = ((data.cells as unknown[]) ?? []).map((c) => fullRichText(ws, c));
  if (data.type === 'file_upload') {
    const up = ws.uploads.get(String((data.file_upload as Obj).id));
    data.type = 'file';
    data.file = { url: `https://prod-files-secure.s3.us-west-2.amazonaws.com/fake/${up?.filename ?? 'file'}?X-Amz-Signature=up`, expiry_time: '2099-01-01T00:00:00.000Z' };
    delete data.file_upload;
  }
  const time = at ?? now(ws);
  const b: FakeBlock = { object: 'block', id: newId(ws), type, has_children: false, archived: false, in_trash: false, parent: parentRef(ws, parent), created_time: time, last_edited_time: time, [type]: data };
  ws.blocks.set(norm(b.id), b);
  const list = ws.children.get(norm(parent)) ?? [];
  const pos = after ? list.indexOf(norm(after)) : -1;
  if (pos >= 0) list.splice(pos + 1, 0, norm(b.id));
  else list.push(norm(b.id));
  ws.children.set(norm(parent), list);
  ws.children.set(norm(b.id), []);
  const pb = ws.blocks.get(norm(parent));
  if (pb) pb.has_children = true;
  for (const k of kids) createBlock(ws, b.id, k, time);
  return b;
}

function touchPage(ws: FakeWorkspace, blockOrPage: string) {
  // Sube hasta la página y le cambia last_edited_time (como Notion).
  let key = norm(blockOrPage);
  for (let i = 0; i < 30; i++) {
    const p = ws.pages.get(key);
    if (p) {
      p.last_edited_time = now(ws);
      return;
    }
    const b = ws.blocks.get(key);
    if (!b) return;
    const par = b.parent as Obj;
    key = norm(String(par.page_id ?? par.block_id ?? ''));
  }
}

function pageProps(ws: FakeWorkspace, dbId: string | null, props: Record<string, Obj>, prev: Record<string, Obj> = {}): Record<string, Obj> {
  const out: Record<string, Obj> = { ...prev };
  const schema = dbId ? ((ws.databases.get(norm(dbId))?.properties as Record<string, Obj>) ?? {}) : { title: { id: 'title', type: 'title' } };
  for (const [name, value] of Object.entries(props ?? {})) {
    const s = schema[name] ?? Object.values(schema).find((x) => x.id === name) ?? (name === 'title' ? { id: 'title', type: 'title' } : null);
    if (!s) continue;
    const type = String(s.type);
    let v = value[type];
    if (type === 'title' || type === 'rich_text') v = fullRichText(ws, v);
    if (type === 'people') v = ((v as Obj[]) ?? []).map((p) => ws.users.find((u) => norm(String(u.id)) === norm(String(p.id))) ?? p);
    if (type === 'select' && v) v = { name: (v as Obj).name };
    if (type === 'multi_select') v = ((v as Obj[]) ?? []).map((o) => ({ name: o.name }));
    const key = Object.keys(schema).find((k) => schema[k] === s) ?? name;
    out[key] = { id: s.id, type, [type]: v ?? null, ...(type === 'relation' ? { has_more: false } : {}) };
  }
  return out;
}

// ---------- API ----------

export function notionSyncFakeWorkspace(token: string): FakeWorkspace {
  let ws = store().get(token);
  if (!ws) {
    ws = seed();
    store().set(token, ws);
  }
  return ws;
}

export function resetNotionSyncFake(token?: string): void {
  if (token) store().delete(token);
  else store().clear();
}

/** fetch de la API de Notion contra el workspace con estado del token. */
export function notionSyncFakeFetch(): NotionFetch {
  return async (url, init) => {
    if (url.startsWith('https://prod-files-secure.s3.us-west-2.amazonaws.com/fake/')) {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
      return new Response(new Uint8Array(png), { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(png.length) } });
    }
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v1/, '');
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    if (path === '/oauth/token' && method === 'POST') return oauthToken(headers, init.body);
    const auth = headers.get('authorization') ?? '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!isNotionSyncFakeToken(token)) return err(401, 'unauthorized');
    const ws = notionSyncFakeWorkspace(token);
    let body: Obj = {};
    if (typeof init.body === 'string' && init.body) {
      try {
        body = JSON.parse(init.body) as Obj;
      } catch {
        return err(400, 'invalid_json');
      }
    }
    ws.log.push({ method, path });
    return route(ws, method, path, u.searchParams, body, init.body);
  };
}

function oauthToken(headers: Headers, raw: unknown): Response {
  const basic = Buffer.from((headers.get('authorization') ?? '').replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
  if (!basic.startsWith('fake-client:')) return err(401, 'invalid_client');
  let body: Obj = {};
  try {
    body = JSON.parse(String(raw ?? '{}')) as Obj;
  } catch {
    return err(400, 'invalid_request');
  }
  if (body.grant_type !== 'authorization_code' || typeof body.code !== 'string' || !body.code.startsWith('fake-code')) return err(400, 'invalid_grant');
  const suffix = body.code.slice('fake-code'.length);
  return json({
    access_token: `${NOTION_SYNC_FAKE_PREFIX}${suffix}`,
    token_type: 'bearer',
    bot_id: 'fake-bot',
    workspace_id: SYNC_FAKE_IDS.notionWorkspace,
    workspace_name: 'Acme (fake)',
    workspace_icon: null,
    owner: { type: 'user', user: { object: 'user', id: SYNC_FAKE_IDS.ana } },
  });
}

function blockOut(b: FakeBlock): Obj {
  return { ...b };
}

function route(ws: FakeWorkspace, method: string, path: string, q: URLSearchParams, body: Obj, raw: unknown): Response {
  let m: RegExpExecArray | null;
  if (path === '/users/me') return json({ object: 'user', id: 'fake-bot', type: 'bot', name: 'zerosoft sync', bot: { workspace_name: 'Acme (fake)', owner: { type: 'workspace', workspace: true } } });
  if (path === '/users') return json(list(ws.users, q.get('start_cursor')));
  if (path === '/search' && method === 'POST') {
    const all = [...ws.pages.values(), ...ws.databases.values()].filter((p) => !p.archived && !p.in_trash);
    const sorted = [...all].sort((a, b) => String(b.last_edited_time).localeCompare(String(a.last_edited_time)));
    if ((body.sort as Obj | undefined)?.direction === 'ascending') sorted.reverse();
    return json(list(sorted, (body.start_cursor as string) ?? null, Number(body.page_size ?? 100)));
  }
  if ((m = /^\/pages\/([^/]+)$/.exec(path))) {
    const p = ws.pages.get(norm(m[1]));
    if (!p) return err(404, 'object_not_found');
    if (method === 'GET') return json(p);
    if (method === 'PATCH') {
      const dbId = (p.parent as Obj).type === 'database_id' ? String((p.parent as Obj).database_id) : null;
      if (body.properties) p.properties = pageProps(ws, dbId, body.properties as Record<string, Obj>, p.properties as Record<string, Obj>);
      if ('icon' in body) p.icon = body.icon;
      if ('archived' in body) p.archived = Boolean(body.archived);
      if ('in_trash' in body) p.in_trash = Boolean(body.in_trash);
      p.last_edited_time = now(ws);
      return json(p);
    }
  }
  if (path === '/pages' && method === 'POST') {
    const parent = body.parent as Obj;
    const dbId = parent?.database_id ? String(parent.database_id) : null;
    const pageParent = parent?.page_id ? String(parent.page_id) : null;
    if (dbId && !ws.databases.has(norm(dbId))) return err(404, 'object_not_found');
    if (pageParent && !ws.pages.has(norm(pageParent))) return err(404, 'object_not_found');
    if (!dbId && !pageParent) return err(400, 'validation_error');
    const id = newId(ws);
    const t = now(ws);
    const p: Obj = {
      object: 'page', id, created_time: t, last_edited_time: t, archived: false, in_trash: false, icon: body.icon ?? null,
      parent: dbId ? { type: 'database_id', database_id: String(ws.databases.get(norm(dbId))!.id) } : { type: 'page_id', page_id: String(ws.pages.get(norm(pageParent!))!.id) },
      properties: pageProps(ws, dbId, (body.properties as Record<string, Obj>) ?? {}), url: `https://www.notion.so/${norm(id)}`,
    };
    ws.pages.set(norm(id), p);
    ws.children.set(norm(id), []);
    if (pageParent) {
      const cb = createBlock(ws, pageParent, { type: 'child_page', child_page: { title: titleOf(p) } }, t);
      ws.blocks.delete(norm(cb.id));
      const kids = ws.children.get(norm(pageParent))!;
      kids[kids.length - 1] = norm(id);
      cb.id = id;
      ws.blocks.set(norm(id), cb);
    }
    for (const k of (body.children as Obj[]) ?? []) createBlock(ws, id, k, t);
    return json(p);
  }
  if ((m = /^\/databases\/([^/]+)\/query$/.exec(path)) && method === 'POST') {
    const db = ws.databases.get(norm(m[1]));
    if (!db) return err(404, 'object_not_found');
    const rows = [...ws.pages.values()].filter((p) => (p.parent as Obj).type === 'database_id' && norm(String((p.parent as Obj).database_id)) === norm(m![1]) && !p.archived && !p.in_trash);
    return json(list(rows, (body.start_cursor as string) ?? null, Number(body.page_size ?? 100)));
  }
  if ((m = /^\/databases\/([^/]+)$/.exec(path))) {
    const db = ws.databases.get(norm(m[1]));
    if (!db) return err(404, 'object_not_found');
    if (method === 'GET') return json(db);
    if (method === 'PATCH') {
      if (body.title) db.title = fullRichText(ws, body.title);
      if ('archived' in body) db.archived = Boolean(body.archived);
      const props = { ...(db.properties as Record<string, Obj>) };
      for (const [name, def] of Object.entries((body.properties as Record<string, Obj | null>) ?? {})) {
        const key = Object.keys(props).find((k) => k === name || props[k].id === name);
        if (def === null) {
          if (key) delete props[key];
          continue;
        }
        if (key) {
          const renamed = typeof def.name === 'string' ? def.name : key;
          const merged = { ...props[key], ...def, name: renamed };
          delete props[key];
          props[renamed] = merged;
        } else {
          const type = Object.keys(def).find((k) => k !== 'name') ?? 'rich_text';
          props[name] = { id: Math.random().toString(36).slice(2, 6), name, type, [type]: def[type] ?? {} };
        }
      }
      db.properties = props;
      db.last_edited_time = now(ws);
      return json(db);
    }
  }
  if (path === '/databases' && method === 'POST') {
    const parent = body.parent as Obj;
    const pageParent = String(parent?.page_id ?? '');
    if (!ws.pages.has(norm(pageParent))) return err(404, 'object_not_found');
    const id = newId(ws);
    const t = now(ws);
    const props: Record<string, Obj> = {};
    for (const [name, def] of Object.entries((body.properties as Record<string, Obj>) ?? {})) {
      const type = Object.keys(def).find((k) => k !== 'name') ?? 'rich_text';
      props[name] = { id: type === 'title' ? 'title' : Math.random().toString(36).slice(2, 6), name, type, [type]: def[type] ?? {} };
    }
    const db: Obj = { object: 'database', id, created_time: t, last_edited_time: t, archived: false, in_trash: false, is_inline: Boolean(body.is_inline), title: fullRichText(ws, body.title), description: [], icon: null, parent: { type: 'page_id', page_id: String(ws.pages.get(norm(pageParent))!.id) }, properties: props };
    ws.databases.set(norm(id), db);
    const cb = createBlock(ws, pageParent, { type: 'child_database', child_database: { title: titleOf(db) } }, t);
    ws.blocks.delete(norm(cb.id));
    const kids = ws.children.get(norm(pageParent))!;
    kids[kids.length - 1] = norm(id);
    cb.id = id;
    ws.blocks.set(norm(id), cb);
    return json(db);
  }
  if ((m = /^\/blocks\/([^/]+)\/children$/.exec(path))) {
    const key = norm(m[1]);
    if (!ws.pages.has(key) && !ws.blocks.has(key)) return err(404, 'object_not_found');
    if (method === 'GET') {
      const ids = (ws.children.get(key) ?? []).filter((id) => {
        const b = ws.blocks.get(id);
        return b && !b.archived;
      });
      return json(list(ids.map((id) => blockOut(ws.blocks.get(id)!)), q.get('start_cursor'), Number(q.get('page_size') ?? 100)));
    }
    if (method === 'PATCH') {
      const kids = (body.children as Obj[]) ?? [];
      if (kids.length > 100) return err(400, 'validation_error');
      let after = (body.after as string | undefined) ?? null;
      if (after && !(ws.children.get(key) ?? []).includes(norm(after))) return err(400, 'validation_error');
      const created: Obj[] = [];
      for (const k of kids) {
        const b = createBlock(ws, m[1], k, undefined, after);
        after = b.id;
        created.push(blockOut(b));
      }
      touchPage(ws, m[1]);
      return json({ object: 'list', results: created, has_more: false, next_cursor: null });
    }
  }
  if ((m = /^\/blocks\/([^/]+)$/.exec(path))) {
    const b = ws.blocks.get(norm(m[1]));
    if (!b) return err(404, 'object_not_found');
    if (method === 'GET') return json(blockOut(b));
    if (method === 'DELETE') {
      if (b.archived) return err(400, 'validation_error');
      b.archived = true;
      b.in_trash = true;
      if (b.type === 'child_page') {
        const p = ws.pages.get(norm(b.id));
        if (p) p.archived = true;
      }
      touchPage(ws, String((b.parent as Obj).page_id ?? (b.parent as Obj).block_id));
      return json(blockOut(b));
    }
    if (method === 'PATCH') {
      if (b.archived) return err(400, 'validation_error');
      if ('archived' in body) b.archived = Boolean(body.archived);
      const data = body[b.type] as Obj | undefined;
      const otherType = Object.keys(body).find((k) => k !== b.type && k !== 'archived' && k !== 'in_trash' && k !== 'type');
      if (otherType) return err(400, 'validation_error');
      if (data) {
        const next = { ...(b[b.type] as Obj), ...data };
        if ('rich_text' in data) next.rich_text = fullRichText(ws, data.rich_text);
        if ('caption' in data) next.caption = fullRichText(ws, data.caption);
        if (b.type === 'table_row' && data.cells) next.cells = (data.cells as unknown[]).map((c) => fullRichText(ws, c));
        b[b.type] = next;
      }
      b.last_edited_time = now(ws);
      touchPage(ws, b.id);
      return json(blockOut(b));
    }
  }
  if (path === '/comments') {
    if (method === 'GET') {
      const target = norm(q.get('block_id') ?? '');
      const rows = ws.comments.filter((c) => norm(String((c.parent as Obj).page_id ?? (c.parent as Obj).block_id ?? '')) === target);
      return json(list(rows, q.get('start_cursor')));
    }
    if (method === 'POST') {
      const t = now(ws);
      const discussion = typeof body.discussion_id === 'string' ? body.discussion_id : newId(ws);
      const parent = body.parent ? (body.parent as Obj) : (ws.comments.find((c) => c.discussion_id === discussion)?.parent as Obj);
      if (!parent) return err(400, 'validation_error');
      const c = { object: 'comment', id: newId(ws), discussion_id: discussion, parent, created_time: t, last_edited_time: t, created_by: { object: 'user', id: 'fake-bot' }, rich_text: fullRichText(ws, body.rich_text) };
      ws.comments.push(c);
      return json(c);
    }
  }
  if (path === '/file_uploads' && method === 'POST') {
    const id = newId(ws);
    const up = { object: 'file_upload', id, status: 'pending', filename: String(body.filename ?? 'file'), content_type: String(body.content_type ?? ''), upload_url: `https://api.notion.com/v1/file_uploads/${id}/send` };
    ws.uploads.set(id, up);
    return json(up);
  }
  if ((m = /^\/file_uploads\/([^/]+)\/send$/.exec(path)) && method === 'POST') {
    const up = ws.uploads.get(m[1]);
    if (!up) return err(404, 'object_not_found');
    if (!(raw instanceof FormData) || !raw.get('file')) return err(400, 'validation_error');
    up.status = 'uploaded';
    return json(up);
  }
  return err(404, 'object_not_found');
}

/**
 * Edición "de una persona en Notion" (solo e2e y tests): misma API, otro
 * camino. Devuelve lo que respondería Notion.
 */
export async function notionSyncFakeCall(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  if (!isNotionSyncFakeToken(token)) return { status: 401, data: null };
  const res = await notionSyncFakeFetch()(`https://api.notion.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

/** Pedidos que recibió el workspace falso (los tests cuentan escrituras). */
export function notionSyncFakeLog(token: string): Array<{ method: string; path: string }> {
  return notionSyncFakeWorkspace(token).log;
}
