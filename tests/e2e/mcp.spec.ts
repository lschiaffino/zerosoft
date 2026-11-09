import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { e2eDb } from './helpers/db';
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * MCP unificado contra la app real: login OAuth de punta a punta con un cliente
 * que sigue la spec, operaciones en muchas apps confirmadas en el navegador, la
 * CLI real, los casos de fallo y las pantallas a 390 y 1280.
 */
const PORT = Number(process.env.E2E_PORT) || 3210;
const BASE = `http://localhost:${PORT}`;
const ENDPOINT = `${BASE}/api/mcp`;
const SHOTS = process.env.MCP_SHOTS_DIR || '';

const uid = () => Math.random().toString(36).slice(2, 8);
const db = () => e2eDb();

async function asPerson(browser: Browser, email: string | null, opts: { colorScheme?: 'light' | 'dark'; width?: number; height?: number } = {}) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    colorScheme: opts.colorScheme ?? 'light',
    viewport: { width: opts.width ?? 1280, height: opts.height ?? 900 },
  });
  if (email) await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: BASE }]);
  return ctx;
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(width, `${name}: scroll horizontal`).toBeLessThanOrEqual(0);
}

// ---------- Cliente que sigue la spec, sin atajos ----------

async function discoverFrom401() {
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
  expect(res.status).toBe(401);
  const header = res.headers.get('www-authenticate') ?? '';
  const url = /resource_metadata="([^"]+)"/.exec(header)?.[1];
  expect(url).toBeTruthy();
  const resource = (await (await fetch(url!)).json()) as { resource: string; authorization_servers: string[]; scopes_supported: string[] };
  expect(resource.resource).toBe(ENDPOINT);
  const meta = (await (await fetch(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown> & {
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
    revocation_endpoint: string;
    device_authorization_endpoint: string;
    issuer: string;
  };
  expect(meta.code_challenge_methods_supported).toEqual(['S256']);
  return { resource, meta };
}

async function loopback() {
  let resolve: (u: URL) => void = () => undefined;
  const got = new Promise<URL>((r) => (resolve = r));
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>done</title>done');
    resolve(new URL(req.url!, 'http://127.0.0.1'));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  return { uri: `http://127.0.0.1:${port}/callback`, got, close: () => server.close() };
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  scope: string;
  expires_in: number;
}

/** Hasta la pantalla de permisos, para que cada test decida qué hacer ahí. */
async function startAuthorization(page: Page, scope = 'read write', clientName = 'Claude Code') {
  const { resource, meta } = await discoverFrom401();
  const cb = await loopback();
  const reg = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: clientName, redirect_uris: [cb.uri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
  });
  expect(reg.status).toBe(201);
  const client = (await reg.json()) as { client_id: string };
  const verifier = randomBytes(48).toString('base64url');
  const state = randomBytes(12).toString('hex');
  const u = new URL(meta.authorization_endpoint);
  u.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: cb.uri,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    scope,
    state,
    resource: resource.resource,
  }).toString();
  await page.goto(u.toString());
  // El título corta los nombres largos: alcanza con el principio.
  await expect(page.getByRole('heading', { name: new RegExp(clientName.slice(0, 30)) })).toBeVisible();
  return { meta, resource, cb, client, verifier, state };
}

type Started = Awaited<ReturnType<typeof startAuthorization>>;

async function finishAuthorization(page: Page, s: Started): Promise<Tokens> {
  await page.getByRole('button', { name: 'Allow access' }).click();
  const back = await s.cb.got;
  // Que el navegador termine de llegar al callback antes de seguir usando la página.
  await page.waitForURL(/\/callback/);
  s.cb.close();
  expect(back.searchParams.get('state')).toBe(s.state);
  expect(back.searchParams.get('iss')).toBe(s.meta.issuer);
  const res = await fetch(s.meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: s.client.client_id,
      code: back.searchParams.get('code')!,
      redirect_uri: s.cb.uri,
      code_verifier: s.verifier,
      resource: s.resource.resource,
    }).toString(),
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Tokens;
}

async function connect(page: Page, scope = 'read write', name = 'Claude Code') {
  const s = await startAuthorization(page, scope, name);
  return { ...s, tokens: await finishAuthorization(page, s) };
}

class Mcp {
  id = 1;
  constructor(public token: string) {}
  async raw(method: string, params?: unknown) {
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: this.id++, method, params }),
    });
  }
  async tool(name: string, args: unknown = {}) {
    const res = await this.raw('tools/call', { name, arguments: args });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result: { isError?: boolean; content: Array<{ text: string }> } };
    return json.result;
  }
  async json(name: string, args: unknown = {}) {
    const r = await this.tool(name, args);
    const text = r.content[0].text;
    // Lo que trae nombres de otras personas viene en el sobre <untrusted_data>.
    return JSON.parse(text.startsWith('<untrusted_data') ? text.slice(text.indexOf('\n') + 1, text.lastIndexOf('\n')) : text) as Record<string, any>;
  }
  /** Una operación: abre el sobre <untrusted_data> como lo leería el modelo. */
  async op(operation: string, args: unknown = {}, extra: Record<string, unknown> = {}) {
    const r = await this.tool('invoke_operation', { operation, args, ...extra });
    const text = r.content[0].text;
    if (!text.startsWith('<untrusted_data')) return { error: JSON.parse(text) as Record<string, any>, status: 0, ok: false, data: null as any };
    const inner = text.slice(text.indexOf('\n') + 1, text.lastIndexOf('\n'));
    return JSON.parse(inner) as { ok: boolean; status: number; data: any; error?: undefined };
  }
}

// ---------- CLI real ----------

function cli(args: string[], env: Record<string, string>, onStderr?: (chunk: string) => void) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), 'cli/bin/zerosoft.mjs'), ...args], {
      env: { ...process.env, ZEROSOFT_URL: BASE, ZEROSOFT_NO_KEYCHAIN: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => {
      stderr += d;
      onStderr?.(String(d));
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function cliLogin(page: Page, env: Record<string, string>, extra: string[] = []) {
  let url = '';
  const running = cli(['login', '--no-open', ...extra], env, (chunk) => {
    const m = /https?:\/\/\S+\/api\/oauth\/authorize\S+/.exec(chunk);
    if (m) url = m[0];
  });
  await expect.poll(() => url, { timeout: 15_000 }).not.toBe('');
  await page.goto(url);
  await page.getByRole('button', { name: 'Allow access' }).click();
  const done = await running;
  expect(done.code, done.stderr).toBe(0);
  return done;
}

const tmpEnv = () => ({ ZEROSOFT_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'zs-cli-')) });

// ---------- Tests ----------

test('metadatos de descubrimiento', async () => {
  for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp', '/.well-known/oauth-authorization-server']) {
    const res = await fetch(`${BASE}${p}`);
    expect(res.status, p).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  }
  const { meta } = await discoverFrom401();
  expect(meta.issuer).toBe(BASE);
  expect(meta.token_endpoint_auth_methods_supported).toEqual(['none']);
  expect(meta.authorization_response_iss_parameter_supported).toBe(true);
  expect((await fetch(ENDPOINT)).status).toBe(405);
});

test('el pedido de autorización valida antes de mostrar nada', async ({ page }) => {
  const { meta } = await discoverFrom401();
  const reg = (await (
    await fetch(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://client.example/cb'] }) })
  ).json()) as { client_id: string };
  const base = { response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://client.example/cb', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', resource: ENDPOINT };
  const go = (p: Record<string, string>) => fetch(`${meta.authorization_endpoint}?${new URLSearchParams(p)}`, { redirect: 'manual' });

  // Inválido: siempre a una página nuestra, nunca a una URI que registró cualquiera.
  const wrong = await go({ ...base, redirect_uri: 'https://evil.example/cb' });
  expect(wrong.headers.get('location')).toContain('/oauth/error?reason=redirect');
  expect((await go({ ...base, client_id: 'nope' })).headers.get('location')).toContain('/oauth/error?reason=client');
  // PKCE obligatorio, solo S256, y solo este recurso.
  const bads: Array<Record<string, string>> = [{ code_challenge: '' }, { code_challenge_method: 'plain' }, { resource: 'https://other.example/mcp' }, { response_type: 'token' }];
  // Un scope inválido: a un https registrado no se redirige sin login, va a nuestra página.
  const scoped = await go({ ...base, scope: 'admin', state: 's1' });
  expect(scoped.headers.get('location')).toContain('/oauth/error?reason=scope');
  // A una app local sí, que está esperando en loopback.
  const local = (await (await fetch(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:9/callback'] }) })).json()) as { client_id: string };
  const localBack = await go({ ...base, client_id: local.client_id, redirect_uri: 'http://127.0.0.1:9/callback', scope: 'admin', state: 's1' });
  const back = new URL(localBack.headers.get('location')!);
  expect(back.origin).toBe('http://127.0.0.1:9');
  expect(back.searchParams.get('error')).toBe('invalid_scope');
  expect(back.searchParams.get('state')).toBe('s1');
  for (const bad of bads) {
    const r = await go({ ...base, ...bad });
    expect(r.status, JSON.stringify(bad)).toBe(302);
    const to = new URL(r.headers.get('location')!);
    expect(to.origin, JSON.stringify(bad)).toBe(BASE);
    expect(to.pathname, JSON.stringify(bad)).toContain('/oauth/error');
  }
  await page.goto('/en/oauth/error?reason=pkce');
  await expect(page.getByRole('heading', { name: 'This connection request is not valid' })).toBeVisible();
  await shot(page, 'oauth-error-1280-light');
  const ok = await go(base);
  expect(ok.status).toBe(302);
  expect(ok.headers.get('location')).toContain('/oauth/consent?request=');
  await page.goto(ok.headers.get('location')!);
  await expect(page.getByText('Returns to client.example')).toBeVisible();

  // Sin marcos, y sin decidir desde otro origen.
  const html = await fetch(ok.headers.get('location')!);
  expect(html.headers.get('x-frame-options')).toBe('DENY');
  const cross = await fetch(`${BASE}/api/oauth/consent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ request: 'x', decision: 'approve' }),
  });
  expect(cross.status).toBe(403);
});

test('sin sesión pasa por el login normal, con código por email, y vuelve a la pantalla de permisos', async ({ browser }) => {
  test.setTimeout(90_000);
  const email = `login${uid()}@mcp.example.com`;
  const ctx = await asPerson(browser, 'session');
  const page = await ctx.newPage();
  const { meta, resource } = await discoverFrom401();
  const cb = await loopback();
  const client = (await (
    await fetch(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Login test', redirect_uris: [cb.uri] }) })
  ).json()) as { client_id: string };
  const verifier = randomBytes(48).toString('base64url');
  const u = new URL(meta.authorization_endpoint);
  u.search = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: cb.uri, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', scope: 'read write', state: 'st', resource: resource.resource }).toString();
  await page.goto(u.toString());
  await expect(page).toHaveURL(/\/auth\/signin\?callbackUrl=/);
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: /code/i }).click();
  await expect(page.getByLabel('Code')).toBeFocused();
  let code = '';
  await expect
    .poll(() => {
      const file = process.env.E2E_MAIL_FILE!;
      if (!fs.existsSync(file)) return '';
      const mail = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { to: string; text: string }).filter((m) => m.to === email).pop();
      code = mail ? (/^(\d{6})$/m.exec(mail.text)?.[1] ?? '') : '';
      return code;
    })
    .not.toBe('');
  await page.getByLabel('Code').fill(code);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Login test/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(`It will act as ${email}`)).toBeVisible();
  await page.getByRole('button', { name: 'Allow access' }).click();
  const back = await cb.got;
  cb.close();
  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id, code: back.searchParams.get('code')!, redirect_uri: cb.uri, code_verifier: verifier, resource: resource.resource }).toString(),
  });
  const tokens = (await res.json()) as Tokens;
  expect((await new Mcp(tokens.access_token).json('whoami')).person.email).toBe(email);
  await ctx.close();
});

test('Esc cancela apenas abre la pantalla de permisos', async ({ page }) => {
  const s = await startAuthorization(page);
  await page.keyboard.press('Escape');
  const back = await s.cb.got;
  s.cb.close();
  expect(back.searchParams.get('error')).toBe('access_denied');
});

test('un nombre largo no ocupa la pantalla y queda marcado como propio del cliente', async ({ browser }) => {
  const ctx = await asPerson(browser, null, { width: 390, height: 844 });
  const page = await ctx.newPage();
  const name = 'Claude Code Official Verified Enterprise Connector For Your Whole Account Forever';
  const s = await startAuthorization(page, 'read write', 'Claude Code Official');
  s.cb.close();
  const { meta, resource } = await discoverFrom401();
  const cb = await loopback();
  const client = (await (await fetch(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: [cb.uri] }) })).json()) as { client_id: string };
  const u = new URL(meta.authorization_endpoint);
  u.search = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: cb.uri, code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', resource: resource.resource }).toString();
  await page.goto(u.toString());
  const h1 = page.getByRole('heading').first();
  await expect(h1).toContainText('…');
  expect((await h1.boundingBox())!.height).toBeLessThan(140);
  await expect(page.getByText('zerosoft has not verified it')).toBeVisible();
  await shot(page, 'consent-longname-390-light');
  cb.close();
  await ctx.close();
});

test('cancelar vuelve con access_denied y el pedido queda muerto', async ({ page }) => {
  const s = await startAuthorization(page);
  await page.getByRole('button', { name: 'Cancel' }).click();
  const back = await s.cb.got;
  s.cb.close();
  expect(back.searchParams.get('error')).toBe('access_denied');
  expect(back.searchParams.get('code')).toBeNull();
});

test('login completo, herramientas, y operaciones en muchas apps vistas en el navegador', async ({ page }) => {
  test.setTimeout(240_000);
  const { tokens } = await connect(page);
  expect(tokens.scope).toBe('read write');
  const mcp = new Mcp(tokens.access_token);

  const init = (await (await mcp.raw('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } })).json()) as any;
  expect(init.result.protocolVersion).toBe('2025-11-25');
  expect(init.result.serverInfo.name).toBe('zerosoft');
  expect(init.result.instructions).toContain('search_operations');

  const list = (await (await mcp.raw('tools/list')).json()) as any;
  const names = list.result.tools.map((t: any) => t.name);
  for (const n of ['whoami', 'list_apps', 'search_operations', 'get_operation_schema', 'invoke_operation']) expect(names).toContain(n);
  // Descubrimiento progresivo más los atajos de las apps prioritarias: una lista corta igual.
  for (const n of ['list_group_chats', 'send_group_message', 'list_track_issues', 'search_docs', 'list_boards']) expect(names).toContain(n);
  expect(names.length).toBeLessThanOrEqual(30);
  expect(list.result.tools.find((t: any) => t.name === 'search_operations').annotations.readOnlyHint).toBe(true);
  expect(list.result.tools.find((t: any) => t.name === 'invoke_operation').annotations.destructiveHint).toBe(true);

  const me = await mcp.json('whoami');
  expect(me.person.email).toBe('demo@zerosoft.ai');
  const apps = await mcp.json('list_apps');
  expect(apps.apps.length).toBeGreaterThanOrEqual(24);
  const found = await mcp.json('search_operations', { query: 'deal move' });
  expect(found.operations.map((o: any) => o.id)).toContain('crm.deals.move');
  const schema = await mcp.json('get_operation_schema', { operation: 'crm.deals.update' });
  expect(schema.schema).toBe('real');
  expect(schema.inputSchema.properties.body.properties.amount.type).toBe('number');
  expect(schema.annotations.readOnlyHint).toBe(false);

  // CRUD real, y cada paso se mira en la lista de la app.
  const cases: Array<{
    app: string;
    list: string;
    create: [string, Record<string, unknown>];
    pick?: (d: any) => string;
    update?: [string, (name: string) => Record<string, unknown>];
    read: string;
    remove: string;
    shown?: (name: string) => RegExp | string;
  }> = [
    { app: 'crm', list: '/en/app/crm/companies', create: ['crm.companies.create', { name: 'NAME' }], update: ['crm.companies.update', (name) => ({ name })], read: 'crm.companies.get', remove: 'crm.companies.delete' },
    { app: 'docs', list: '/en/app/docs', create: ['docs.pages.create', { title: 'NAME' }], update: ['docs.pages.update', (title) => ({ title })], read: 'docs.pages.get', remove: 'docs.pages.delete' },
    { app: 'notes', list: '/en/app/notes', create: ['notes.create', { title: 'NAME', content: [] }], update: ['notes.update', (title) => ({ title })], read: 'notes.get', remove: 'notes.delete' },
    { app: 'board', list: '/en/app/board', create: ['boards.create', { name: 'NAME' }], update: ['boards.update', (name) => ({ name })], read: 'boards.get', remove: 'boards.delete' },
    { app: 'cal', list: '/en/app/calendar/event-types', create: ['calendar.event_types.create', { title: 'NAME', slug: 'SLUG', durationMin: 30, active: true }], update: ['calendar.event_types.update', (title) => ({ title })], read: 'calendar.event_types.get', remove: 'calendar.event_types.delete' },
    { app: 'link', list: '/en/app/links', create: ['links.create', { url: 'https://example.com/mcp', title: 'NAME' }], update: ['links.update', (title) => ({ title })], read: 'links.get', remove: 'links.delete' },
    { app: 'chat', list: '/en/app/chat/widgets', create: ['chat.widgets.create', { name: 'NAME' }], update: ['chat.widgets.update', (name) => ({ name })], read: 'chat.widgets.get', remove: 'chat.widgets.delete' },
    { app: 'flow', list: '/en/app/flow', create: ['flow.flows.create', { name: 'NAME' }], update: ['flow.flows.update', (name) => ({ name })], read: 'flow.flows.get', remove: 'flow.flows.delete' },
    { app: 'agents', list: '/en/app/agents', create: ['agents.create', { name: 'NAME' }], update: ['agents.update', (name) => ({ name })], read: 'agents.get', remove: 'agents.delete' },
    { app: 'shop', list: '/en/app/shop/products', create: ['shop.products.create', { title: 'NAME', status: 'active', variants: [{ options: [], priceCents: 1500, initialStock: 3 }] }], pick: (d) => d.product.id, update: ['shop.products.update', (title) => ({ title })], read: 'shop.products.get', remove: 'shop.products.delete' },
    { app: 'sign', list: '/en/app/sign', create: ['sign.envelopes.create', { title: 'NAME' }], pick: (d) => d.envelope.id, update: ['sign.envelopes.update', (title) => ({ title })], read: 'sign.envelopes.get', remove: 'sign.envelopes.delete' },
    { app: 'track', list: '/en/app/track/initiatives', create: ['track.initiatives.create', { name: 'NAME' }], update: ['track.initiatives.update', (name) => ({ name })], read: 'track.initiatives.get', remove: 'track.initiatives.delete' },
    { app: 'talk', list: '/en/app/talk', create: ['talk.channels.create', { name: 'NAME', kind: 'public' }], read: 'talk.channels.get', remove: 'talk.channels.delete', shown: (n) => n.toLowerCase().replace(/\s+/g, '-') },
  ];
  for (const c of cases) {
    const name = `Mcp ${c.app} ${uid()}`;
    const fill = (b: Record<string, unknown>) => JSON.parse(JSON.stringify(b).replace(/NAME/g, name).replace(/SLUG/g, `mcp-${uid()}`));
    const created = await mcp.op(c.create[0], { body: fill(c.create[1]) });
    expect(created.ok, `${c.app} create: ${JSON.stringify(created)}`).toBe(true);
    const id = c.pick ? c.pick(created.data) : created.data.id;
    expect(id, c.app).toBeTruthy();

    const shown = (n: string) => (c.shown ? c.shown(n) : n);
    await page.goto(c.list);
    await expect(page.getByText(shown(name)).first(), `${c.app}: se ve al crear`).toBeVisible({ timeout: 20_000 });

    const read = await mcp.op(c.read, { path: { id } });
    expect(read.ok, `${c.app} read: ${JSON.stringify(read)}`).toBe(true);

    if (c.update) {
      const renamed = `${name} v2`;
      const updated = await mcp.op(c.update[0], { path: { id }, body: c.update[1](renamed) }, { confirm: true });
      expect(updated.ok, `${c.app} update: ${JSON.stringify(updated)}`).toBe(true);
      await page.goto(c.list);
      await expect(page.getByText(renamed).first(), `${c.app}: se ve el cambio`).toBeVisible({ timeout: 20_000 });
    }

    const blocked = await mcp.op(c.remove, { path: { id } });
    expect(blocked.error?.error, c.app).toBe('confirmation_required');
    // Una nota se borra en dos pasos, como en la app: papelera y después definitivo.
    if (c.app === 'notes') expect((await mcp.op('notes.update', { path: { id }, body: { trashed: true } })).ok).toBe(true);
    const removed = await mcp.op(c.remove, { path: { id } }, { confirm: true });
    expect(removed.ok, `${c.app} delete: ${JSON.stringify(removed)}`).toBe(true);
    await page.goto(c.list);
    await expect(page.getByText(shown(name)), `${c.app}: ya no está`).toHaveCount(0, { timeout: 20_000 });
  }

  // Atajo directo.
  const contact = await mcp.op('crm.contacts.create', { body: { firstName: 'Ana', lastName: uid(), email: `${uid()}@mcp.example.com` } });
  expect(contact.ok).toBe(true);
  const search = await mcp.tool('search_workspace', { q: contact.data.lastName ?? 'Ana' });
  expect(search.isError).toBeFalsy();
  expect(search.content[0].text).toContain('<untrusted_data');

  // Auditoría: cada escritura, sin los datos.
  const client = db();
  const rows = (await client.execute(`SELECT operation, access, status, client_name FROM mcp_audit_log WHERE operation = 'crm.companies.create'`)).rows;
  client.close();
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0].client_name).toBe('Claude Code');
  expect(JSON.stringify(rows)).not.toContain('Mcp crm');
});

test('fallos: vencido, revocado, reuso de refresh, audiencia ajena', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await asPerson(browser, null);
  const page = await ctx.newPage();
  const a = await connect(page, 'read write', `Fail ${uid()}`);
  const mcp = new Mcp(a.tokens.access_token);
  expect((await mcp.json('whoami')).person.email).toBeTruthy();

  // Rotación y reuso.
  const refresh = (token: string) =>
    fetch(a.meta.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: a.client.client_id, refresh_token: token, resource: ENDPOINT }).toString(),
    });
  const r1 = await refresh(a.tokens.refresh_token);
  expect(r1.status).toBe(200);
  const next = (await r1.json()) as Tokens;
  expect(next.refresh_token).not.toBe(a.tokens.refresh_token);
  // Repetirlo enseguida es un refresh en paralelo: da tokens de la misma conexión y no la corta.
  expect((await refresh(a.tokens.refresh_token)).status).toBe(200);
  expect((await new Mcp(next.access_token).raw('tools/list')).status).toBe(200);
  // Pasada la ventana es reuso.
  const hash = createHash('sha256').update(a.tokens.refresh_token).digest('hex');
  const replay = db();
  await replay.execute({ sql: 'UPDATE oauth_tokens SET used_at = ? WHERE token_hash = ?', args: [new Date(Date.now() - 60_000).toISOString(), hash] });
  replay.close();
  expect((await refresh(a.tokens.refresh_token)).status).toBe(400);
  // El reuso cortó la conexión entera.
  const after = await new Mcp(next.access_token).raw('tools/list');
  expect(after.status).toBe(401);
  expect(after.headers.get('www-authenticate')).toContain('invalid_token');

  // Vencido.
  const b = await connect(page, 'read write', `Expired ${uid()}`);
  const client = db();
  await client.execute({ sql: `UPDATE oauth_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE grant_id = (SELECT id FROM oauth_grants WHERE client_id = ? AND revoked_at IS NULL) AND kind = 'access'`, args: [b.client.client_id] });
  expect((await new Mcp(b.tokens.access_token).raw('tools/list')).status).toBe(401);

  // Audiencia ajena.
  const c = await connect(page, 'read write', `Audience ${uid()}`);
  await client.execute({ sql: `UPDATE oauth_grants SET resource = 'https://other.example/mcp' WHERE client_id = ?`, args: [c.client.client_id] });
  expect((await new Mcp(c.tokens.access_token).raw('tools/list')).status).toBe(401);

  // Revocación del cliente (RFC 7009).
  const d = await connect(page, 'read write', `Revoked ${uid()}`);
  const rev = await fetch(a.meta.revocation_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: d.tokens.refresh_token, client_id: d.client.client_id }).toString() });
  expect(rev.status).toBe(200);
  expect((await new Mcp(d.tokens.access_token).raw('tools/list')).status).toBe(401);

  // Una API key sigue valiendo como Bearer, y un token inventado no.
  expect((await new Mcp('zsat_inventado').raw('tools/list')).status).toBe(401);
  // Una key sin el opt-in sigue solo con v1.
  const plain = await page.request.post('/api/keys', { data: { name: `plain ${uid()}` } });
  expect((await new Mcp(((await plain.json()) as { key: string }).key).raw('tools/list')).status).toBe(403);
  const key = await page.request.post('/api/keys', { data: { name: `mcp ${uid()}`, scopes: ['crm:read'], mcp: true } });
  expect(key.status()).toBe(201);
  const keyMcp = new Mcp(((await key.json()) as { key: string }).key);
  expect((await keyMcp.op('crm.contacts.list')).ok).toBe(true);
  expect((await keyMcp.op('crm.contacts.create', { body: { firstName: 'No' } })).error?.error).toBe('insufficient_scope');
  expect((await keyMcp.op('docs.pages.list')).error?.error).toBe('insufficient_scope');
  client.close();
  await ctx.close();
});

test('leer, editar y guardar una página con un link nuestro no lo pisa', async ({ page }) => {
  const { tokens } = await connect(page, 'read write', `Round ${uid()}`);
  const mcp = new Mcp(tokens.access_token);
  const token = 'Xq7Lm2Pz9Rt4Vb8Nc1Kd6Wf3Hs0Jg5Ay';
  const link = `${BASE}/en/sign/${token}`;
  const made = await mcp.op('docs.pages.create', { body: { title: `Link ${uid()}` } });
  expect(made.ok, JSON.stringify(made)).toBe(true);
  const id = made.data.id;
  const filled = await mcp.op('docs.pages.update', { path: { id }, body: { content: [{ id: 'b1', type: 'paragraph', content: `Firmá: ${link}` }] } });
  expect(filled.ok, JSON.stringify(filled)).toBe(true);
  const read = await mcp.op('docs.pages.get', { path: { id } });
  const text = JSON.stringify(read.data);
  expect(text).toContain('[redacted by zerosoft]');
  expect(text).not.toContain(token);
  const edited = await mcp.op('docs.pages.update', { path: { id }, body: { content: [{ id: 'b1', type: 'paragraph', content: 'Firmá ya: [redacted by zerosoft]' }] } });
  expect(edited.error?.error).toBe('invalid_arguments');
  // Sigue guardado el link original, y [redacted] a secas se puede escribir.
  const stored = await page.request.get(`/api/docs/pages/${id}`);
  expect(await stored.text()).toContain(token);
  const plain = await mcp.op('docs.pages.update', { path: { id }, body: { title: 'Nombre [redacted] por GDPR' } });
  expect(plain.ok, JSON.stringify(plain)).toBe(true);
});

test('solo lectura: nunca recibe algo que le permita escribir', async ({ browser }) => {
  const ctx = await asPerson(browser, null);
  const page = await ctx.newPage();
  // El disparador de un flow tiene un webhook con su token.
  const flow = (await (await page.request.post('/api/flow/flows', { data: { name: `Hook ${uid()}` } })).json()) as { id: string };
  const s = await startAuthorization(page, 'read write', `Cap ${uid()}`);
  await page.getByRole('radio', { name: /Read only/ }).check();
  const tokens = await finishAuthorization(page, s);
  const mcp = new Mcp(tokens.access_token);
  const read = await mcp.op('flow.flows.get', { path: { id: flow.id } });
  expect(read.ok, JSON.stringify(read)).toBe(true);
  expect(JSON.stringify(read.data)).not.toMatch(/\bfh_[A-Za-z0-9_-]{8,}/);
  expect(JSON.stringify(read.data)).not.toContain('/api/flow/hooks/');
  // Leer y volver a guardar el grafo funciona, y una credencial se ve en la lista sin su valor.
  const writer = await connect(page, 'read write', `Graph ${uid()}`);
  const graphMcp = new Mcp(writer.tokens.access_token);
  const flowFull = await graphMcp.op('flow.flows.get', { path: { id: flow.id } });
  const saved = await graphMcp.op('flow.flows.update', { path: { id: flow.id }, body: { graph: flowFull.data.flow.graph } }, { confirm: true });
  expect(saved.ok, JSON.stringify(saved)).toBe(true);
  const creds = await mcp.op('flow.credentials.list');
  expect(creds.ok, JSON.stringify(creds)).toBe(true);
  expect(Array.isArray(creds.data.credentials)).toBe(true);
  // Sin efectos de un cambio de workspace en la conexión.
  expect((await mcp.json('switch_workspace', { teamId: null })).error).toBe('reconnect_to_switch');
  await ctx.close();
});

test('solo lectura: elegir eso en la pantalla, y escribir falla sin tocar nada', async ({ browser }) => {
  const ctx = await asPerson(browser, null);
  const page = await ctx.newPage();
  const s = await startAuthorization(page, 'read write', `Read ${uid()}`);
  await page.getByRole('radio', { name: /Read only/ }).check();
  const tokens = await finishAuthorization(page, s);
  expect(tokens.scope).toBe('read');
  const mcp = new Mcp(tokens.access_token);
  expect((await mcp.op('crm.contacts.list')).ok).toBe(true);
  const write = await mcp.op('crm.companies.create', { body: { name: `Nope ${uid()}` } });
  expect(write.error?.error).toBe('insufficient_scope');
  expect((await mcp.json('whoami')).connection.canWrite).toBe(false);
  const tools = (await (await mcp.raw('tools/list')).json()) as any;
  expect(tools.result.tools.map((t: any) => t.name)).not.toContain('create_track_issue');
  await ctx.close();
});

test('roles: owner, admin, member con apps limitadas y alguien de afuera', async ({ browser }) => {
  test.setTimeout(180_000);
  const tag = uid();
  const emails = { owner: `owner${tag}@mcp.example.com`, admin: `admin${tag}@mcp.example.com`, member: `member${tag}@mcp.example.com`, out: `out${tag}@mcp.example.com` };
  const owner = await asPerson(browser, emails.owner);
  const ownerPage = await owner.newPage();
  const team = await ownerPage.request.post('/api/teams', { data: { name: `Acme ${tag}` } });
  expect(team.ok(), await team.text()).toBe(true);
  const teamId = ((await (await ownerPage.request.get('/api/teams')).json()) as { rows: Array<{ teamId: string | null; own: boolean; name: string }>; active: string | null }).active;

  const client = db();
  const ownerRow = (await client.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [emails.owner] })).rows[0];
  const realTeam = (await client.execute({ sql: 'SELECT id FROM teams WHERE owner_id = ? LIMIT 1', args: [ownerRow.id as string] })).rows[0].id as string;
  const team_id = teamId ?? realTeam;

  const signed = async (email: string) => {
    const ctx = await asPerson(browser, email);
    const page = await ctx.newPage();
    await page.goto('/en/app');
    return { ctx, page };
  };
  const admin = await signed(emails.admin);
  const member = await signed(emails.member);
  const out = await signed(emails.out);
  const idOf = async (email: string) => (await client.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] })).rows[0].id as string;
  await client.execute({ sql: `INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'admin', '*')`, args: [team_id, await idOf(emails.admin)] });
  await client.execute({ sql: `INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', ?)`, args: [team_id, await idOf(emails.member), JSON.stringify(['crm'])] });
  await client.execute({ sql: 'UPDATE users SET active_team_id = ? WHERE email IN (?, ?)', args: [team_id, emails.admin, emails.member] });

  const adminMcp = new Mcp((await connect(admin.page, 'read write', `Admin ${tag}`)).tokens.access_token);
  const memberMcp = new Mcp((await connect(member.page, 'read write', `Member ${tag}`)).tokens.access_token);
  const outMcp = new Mcp((await connect(out.page, 'read write', `Out ${tag}`)).tokens.access_token);

  const whoMember = await memberMcp.json('whoami');
  expect(whoMember.role).toBe('member');
  expect(whoMember.workspace.id).toBe(team_id);

  // Invitar se hace desde la web, con cualquier rol: es un acceso que sobrevive a la conexión.
  expect((await adminMcp.op('teams.invites.create', { body: { emails: `inv${tag}@mcp.example.com`, role: 'member' } }, { confirm: true })).error?.error).toBe('web_only');

  // Lo creado en el workspace lo ven los que están.
  const secret = `Secret ${tag}`;
  const created = await adminMcp.op('crm.companies.create', { body: { name: secret } });
  expect(created.ok, JSON.stringify(created)).toBe(true);
  const seenByMember = await memberMcp.op('crm.companies.get', { path: { id: created.data.id } });
  expect(seenByMember.ok).toBe(true);

  // App fuera de su acceso: ni la operación ni el catálogo.
  expect((await memberMcp.op('docs.pages.list')).error?.error).toBe('app_not_available');
  expect((await memberMcp.op('v1.docs.pages.list')).error?.error).toBe('app_not_available');
  expect((await memberMcp.json('search_operations', { app: 'docs' })).total).toBe(0);
  const memberApps = (await memberMcp.json('list_apps')).apps.map((a: any) => a.app);
  expect(memberApps).toContain('crm');
  expect(memberApps).not.toContain('docs');
  expect((await adminMcp.op('docs.pages.list')).ok).toBe(true);

  // Lo que un member no puede en la UI tampoco por acá: el handler real responde 403.
  const memberId = await idOf(emails.member);
  const denied = await memberMcp.op('teams.members.update', { path: { userId: memberId }, body: { apps: ['crm', 'docs'] } }, { confirm: true });
  expect(denied.ok, JSON.stringify(denied)).toBe(false);
  expect(denied.status).toBe(403);
  // Y el rol de admin no se da por acá, ni siquiera siendo admin.
  expect((await adminMcp.op('teams.members.update', { path: { userId: memberId }, body: { role: 'admin' } }, { confirm: true })).error?.error).toBe('web_only');
  const adminCan = await adminMcp.op('teams.members.update', { path: { userId: memberId }, body: { apps: ['crm', 'docs'] } }, { confirm: true });
  expect(adminCan.ok, JSON.stringify(adminCan)).toBe(true);
  expect((await memberMcp.op('docs.pages.list')).ok).toBe(true);
  await client.execute({ sql: 'UPDATE team_members SET apps = ? WHERE team_id = ? AND user_id = ?', args: [JSON.stringify(['crm']), team_id, memberId] });

  // Alguien de afuera no ve nada del workspace, y no puede pasarse a él.
  const outRead = await outMcp.op('crm.companies.get', { path: { id: created.data.id } });
  expect(outRead.ok).toBe(false);
  expect(JSON.stringify((await outMcp.op('crm.companies.list')).data)).not.toContain(secret);
  expect((await outMcp.json('switch_workspace', { teamId: team_id })).error).toBe('reconnect_to_switch');

  // Sacar a alguien corta la conexión en el momento, sin caer a su workspace propio.
  await client.execute({ sql: 'DELETE FROM team_members WHERE team_id = ? AND user_id = ?', args: [team_id, memberId] });
  expect((await memberMcp.op('crm.companies.list')).error?.error).toBe('workspace_access_lost');

  // Cambiar de workspace en el navegador no mueve la conexión del admin.
  const adminId = await idOf(emails.admin);
  await client.execute({ sql: 'UPDATE users SET active_team_id = NULL WHERE id = ?', args: [adminId] });
  expect((await adminMcp.json('whoami')).workspace.id).toBe(team_id);

  client.close();
  for (const c of [owner, admin.ctx, member.ctx, out.ctx]) await c.close();
});

test('Ajustes: lista las conexiones y desconectar corta en el momento', async ({ page }) => {
  const name = `Settings ${uid()}`;
  const { tokens } = await connect(page, 'read write', name);
  const mcp = new Mcp(tokens.access_token);
  await page.goto('/en/app/settings/api');
  const row = page.locator('tr', { hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText('Read and write')).toBeVisible();
  await row.getByRole('button', { name: new RegExp(`Disconnect ${name}`) }).click();
  // Esc cancela.
  await page.keyboard.press('Escape');
  await expect(row).toBeVisible();
  expect((await mcp.raw('tools/list')).status).toBe(200);
  await row.getByRole('button', { name: new RegExp(`Disconnect ${name}`) }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.locator('tr', { hasText: name })).toHaveCount(0);
  expect((await mcp.raw('tools/list')).status).toBe(401);
  await page.reload();
  await expect(page.locator('tr', { hasText: name })).toHaveCount(0);
});

test('CLI: login, descubrir, CRUD en muchas apps, salida y códigos', async ({ page }) => {
  test.setTimeout(240_000);
  const env = tmpEnv();
  expect((await cli(['whoami'], env)).code).toBe(3);
  await cliLogin(page, env);
  const file = path.join(env.ZEROSOFT_CONFIG_DIR, 'credentials.json');
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);

  const who = await cli(['whoami', '--json'], env);
  expect(JSON.parse(who.stdout).person.email).toBe('demo@zerosoft.ai');
  expect(JSON.parse((await cli(['apps'], env)).stdout).apps.length).toBeGreaterThanOrEqual(24);
  // Campos: uno que no existe dice cuáles hay; un teléfono de dígitos sigue siendo texto; el ejemplo de la ayuda funciona.
  const unknown = await cli(['crm', 'contacts', 'create', '--nope', 'x'], env);
  expect(unknown.code).toBe(2);
  expect(unknown.stderr).toContain('Valid fields');
  expect(unknown.stderr).toContain('firstName');
  const phone = await cli(['crm', 'contacts', 'create', '--firstName', 'Ana', '--email', `${uid()}@cli.example.com`, '--phone', '5491155667788'], env);
  expect(phone.code, phone.stderr).toBe(0);
  expect(JSON.parse(phone.stdout).data.phone).toBe('5491155667788');
  const web = await cli(['call', 'webhooks.create', '--json', '{"body":{"url":"https://example.com"}}'], env);
  expect(web.code).toBe(4);
  expect(web.stderr).toContain('Settings');
  expect((await cli(['setup', 'claude'], env)).stdout).not.toContain('claude.ai');
  expect(JSON.parse((await cli(['ops', 'search', 'deal', 'move'], env)).stdout).operations.map((o: any) => o.id)).toContain('crm.deals.move');
  expect(JSON.parse((await cli(['ops', 'show', 'crm.deals.update'], env)).stdout).id).toBe('crm.deals.update');
  expect((await cli(['setup', 'claude'], env)).stdout).toContain(`claude mcp add --transport http zerosoft ${ENDPOINT}`);

  const cases: Array<{ app: string; create: string[]; pick?: (d: any) => string; update?: (n: string) => string[]; get?: string[]; del: string[]; list: string; field?: string }> = [
    { app: 'crm', create: ['crm', 'companies', 'create', '--name', 'NAME'], update: (n) => ['crm', 'companies', 'update', 'ID', '--name', n], get: ['crm', 'companies', 'get', 'ID'], del: ['crm', 'companies', 'delete', 'ID'], list: '/en/app/crm/companies' },
    { app: 'docs', create: ['docs', 'pages', 'create', '--title', 'NAME'], update: (n) => ['docs', 'pages', 'update', 'ID', '--title', n], get: ['docs', 'pages', 'get', 'ID'], del: ['docs', 'pages', 'delete', 'ID'], list: '/en/app/docs' },
    { app: 'notes', create: ['notes', 'create', '--json', '{"body":{"title":"NAME","content":[]}}'], update: (n) => ['notes', 'update', 'ID', '--title', n], get: ['notes', 'get', 'ID'], del: ['notes', 'delete', 'ID'], list: '/en/app/notes' },
    { app: 'board', create: ['board', 'create', '--name', 'NAME'], update: (n) => ['board', 'update', 'ID', '--name', n], get: ['board', 'get', 'ID'], del: ['board', 'delete', 'ID'], list: '/en/app/board' },
    { app: 'link', create: ['link', 'create', '--url', 'https://example.com/cli', '--title', 'NAME'], update: (n) => ['link', 'update', 'ID', '--title', n], get: ['link', 'get', 'ID'], del: ['link', 'delete', 'ID'], list: '/en/app/links' },
    { app: 'cal', create: ['cal', 'event-types', 'create', '--title', 'NAME', '--slug', 'cli-SLUG', '--durationMin', '30', '--active', 'true'], update: (n) => ['cal', 'event-types', 'update', 'ID', '--title', n], get: ['cal', 'event-types', 'get', 'ID'], del: ['cal', 'event-types', 'delete', 'ID'], list: '/en/app/calendar/event-types' },
    { app: 'chat', create: ['chat', 'widgets', 'create', '--name', 'NAME'], update: (n) => ['chat', 'widgets', 'update', 'ID', '--name', n], get: ['chat', 'widgets', 'get', 'ID'], del: ['chat', 'widgets', 'delete', 'ID'], list: '/en/app/chat/widgets' },
    { app: 'flow', create: ['flow', 'flows', 'create', '--name', 'NAME'], update: (n) => ['flow', 'flows', 'update', 'ID', '--name', n], get: ['flow', 'flows', 'get', 'ID'], del: ['flow', 'flows', 'delete', 'ID'], list: '/en/app/flow' },
    { app: 'agents', create: ['agents', 'create', '--name', 'NAME'], update: (n) => ['agents', 'update', 'ID', '--name', n], get: ['agents', 'get', 'ID'], del: ['agents', 'delete', 'ID'], list: '/en/app/agents' },
    { app: 'sign', create: ['sign', 'envelopes', 'create', '--title', 'NAME'], pick: (d) => d.envelope.id, update: (n) => ['sign', 'envelopes', 'update', 'ID', '--title', n], get: ['sign', 'envelopes', 'get', 'ID'], del: ['sign', 'envelopes', 'delete', 'ID'], list: '/en/app/sign' },
    { app: 'shop', create: ['shop', 'products', 'create', '--json', '{"body":{"title":"NAME","status":"active","variants":[{"options":[],"priceCents":1500,"initialStock":3}]}}'], pick: (d) => d.product.id, update: (n) => ['shop', 'products', 'update', 'ID', '--title', n], get: ['shop', 'products', 'get', 'ID'], del: ['shop', 'products', 'delete', 'ID'], list: '/en/app/shop/products' },
    { app: 'track', create: ['track', 'initiatives', 'create', '--name', 'NAME'], update: (n) => ['track', 'initiatives', 'update', 'ID', '--name', n], get: ['track', 'initiatives', 'get', 'ID'], del: ['track', 'initiatives', 'delete', 'ID'], list: '/en/app/track/initiatives' },
  ];
  for (const c of cases) {
    const name = `Cli ${c.app} ${uid()}`;
    const args = c.create.map((a) => a.replace(/NAME/g, name).replace(/SLUG/g, uid()));
    const made = await cli(args, env);
    expect(made.code, `${c.app}: ${made.stdout} ${made.stderr}`).toBe(0);
    const data = JSON.parse(made.stdout).data;
    const id = c.pick ? c.pick(data) : data.id;
    await page.goto(c.list);
    await expect(page.getByText(name).first(), `${c.app}: se ve`).toBeVisible({ timeout: 20_000 });
    const sub = (a: string[]) => a.map((x) => (x === 'ID' ? id : x));
    const got = await cli(sub(c.get!), env);
    expect(got.code, `${c.app}: ${got.stdout} ${got.stderr}`).toBe(0);
    const renamed = `${name} v2`;
    const up = await cli([...sub(c.update!(renamed)), '--confirm'], env);
    expect(up.code, `${c.app}: ${up.stdout} ${up.stderr}`).toBe(0);
    await page.goto(c.list);
    await expect(page.getByText(renamed).first(), `${c.app}: se ve el cambio`).toBeVisible({ timeout: 20_000 });
    const noConfirm = await cli(sub(c.del), env);
    expect(noConfirm.code, c.app).toBe(2);
    expect(noConfirm.stderr).toContain('destructive');
    if (c.app === 'notes') expect((await cli(sub(['notes', 'update', 'ID', '--trashed', 'true']), env)).code).toBe(0);
    const del = await cli([...sub(c.del), '--confirm'], env);
    expect(del.code, `${c.app}: ${del.stdout} ${del.stderr}`).toBe(0);
    await page.goto(c.list);
    await expect(page.getByText(name), `${c.app}: ya no está`).toHaveCount(0, { timeout: 20_000 });
  }

  // call con JSON, alias con plural, y track issues create por la API v1.
  const project = await cli(['call', 'track.projects.create', '--json', `{"body":{"name":"Cli ${uid()}"}}`], env);
  expect(project.code, project.stderr).toBe(0);
  const projectId = JSON.parse(project.stdout).data.id;
  const issue = await cli(['track', 'issues', 'create', '--projectId', projectId, '--title', 'From the CLI'], env);
  expect(issue.code, `${issue.stdout} ${issue.stderr}`).toBe(0);
  expect(JSON.parse(issue.stdout).data).toBeTruthy();

  // Códigos de salida.
  expect((await cli(['nope', 'nothing', 'here'], env)).code).toBe(2);
  expect((await cli(['call'], env)).code).toBe(2);
  const missing = await cli(['crm', 'contacts', 'get', 'does-not-exist'], env);
  expect(missing.code).toBe(4);
  expect((await cli(['--help'], env)).code).toBe(0);
  expect((await cli(['ops', '--help'], env)).code).toBe(0);
  expect((await cli(['crm', 'contacts', 'list', '--help'], env)).stdout).toContain('crm.contacts.list');

  // El access token vencido se renueva solo y rota el refresh.
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  stored[BASE].expiresAt = 0;
  const oldRefresh = stored[BASE].refreshToken;
  fs.writeFileSync(file, JSON.stringify(stored), { mode: 0o600 });
  expect((await cli(['whoami'], env)).code).toBe(0);
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))[BASE].refreshToken).not.toBe(oldRefresh);

  const out = await cli(['logout'], env);
  expect(out.code).toBe(0);
  expect((await cli(['whoami'], env)).code).toBe(3);
});

test('CLI: el dispositivo arranca en solo lectura aunque pida escribir', async ({ page }) => {
  test.setTimeout(90_000);
  const env = tmpEnv();
  let userCode = '';
  let uri = '';
  const running = cli(['login', '--device'], env, (chunk) => {
    userCode = /\b([A-Z]{4}-[A-Z]{4})\b/.exec(chunk)?.[1] ?? userCode;
    uri = /https?:\/\/\S+\/oauth\/device/.exec(chunk)?.[0] ?? uri;
  });
  await expect.poll(() => userCode, { timeout: 15_000 }).not.toBe('');
  await page.goto(uri);
  await page.getByLabel('Code').fill(userCode);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('radio', { name: /Read only/ })).toBeChecked();
  await page.getByRole('button', { name: 'Allow access' }).click();
  await expect(page.getByRole('heading', { name: 'Device connected' })).toBeVisible();
  const done = await running;
  expect(done.code, done.stderr).toBe(0);
  expect(done.stderr).toContain('read only');
  // En Ajustes no figura como "esta computadora".
  await page.goto('/en/app/settings/api');
  await expect(page.locator('#connected')).toContainText('Signed in with a device code');
});

test('CLI: login de dispositivo y solo lectura', async ({ page }) => {
  test.setTimeout(120_000);
  const env = tmpEnv();
  let userCode = '';
  let uri = '';
  const running = cli(['login', '--device', '--read-only'], env, (chunk) => {
    const c = /\b([A-Z]{4}-[A-Z]{4})\b/.exec(chunk);
    if (c) userCode = c[1];
    const u = /https?:\/\/\S+\/oauth\/device/.exec(chunk);
    if (u) uri = u[0];
  });
  await expect.poll(() => userCode, { timeout: 15_000 }).not.toBe('');
  // Un link con el código puesto no salta a los permisos: la persona confirma.
  await page.goto(`${uri}?code=${userCode}`);
  await expect(page.getByLabel('Code')).toHaveValue(userCode);
  await expect(page.getByRole('button', { name: 'Allow access' })).toHaveCount(0);
  await expect(page.getByText('Check that this is the code')).toBeVisible();
  await shot(page, 'device-link-1280-light');
  await page.goto(uri);
  await page.getByLabel('Code').fill('WRONG-CODE');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.ui-error')).toBeVisible();
  await expect(page.getByLabel('Code')).toBeFocused();
  await page.mouse.move(0, 0);
  await shot(page, 'device-error-1280-light');
  await page.getByLabel('Code').fill(userCode.toLowerCase());
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: /zerosoft CLI/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Read and write/ })).toHaveCount(0);
  await expect(page.getByText('Only approve this if you started it yourself')).toBeVisible();
  await shot(page, 'device-consent-1280-light');
  await page.getByRole('button', { name: 'Allow access' }).click();
  await expect(page.getByRole('heading', { name: 'Device connected' })).toBeVisible();
  const done = await running;
  expect(done.code, done.stderr).toBe(0);
  expect(done.stderr).toContain('read only');
  const write = await cli(['crm', 'companies', 'create', '--name', 'Nope'], env);
  expect(write.code, `${write.stdout} ${write.stderr}`).toBe(4);
  expect(write.stderr).toContain('read-only');
  expect((await cli(['crm', 'companies', 'list'], env)).code).toBe(0);
});

test('ningún 404 en las pantallas de permisos y en la documentación', async ({ browser }) => {
  const ctx = await asPerson(browser, null);
  const page = await ctx.newPage();
  const missing: string[] = [];
  page.on('response', (r) => {
    if (r.status() === 404) missing.push(r.url());
  });
  page.on('console', (m) => {
    if (m.type() === 'error') missing.push(`${m.text()} ${m.location().url}`);
  });
  const s = await startAuthorization(page);
  await page.waitForLoadState('networkidle');
  s.cb.close();
  await page.goto('/en/docs/mcp', { waitUntil: 'networkidle' });
  await page.goto('/en/oauth/device', { waitUntil: 'networkidle' });
  await page.getByLabel('Code').fill('WRONG-CODE');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.ui-error')).toBeVisible();
  expect(missing).toEqual([]);
  await ctx.close();
});

test('un nombre largo sin espacios no se sale del diálogo de desconectar', async ({ browser }) => {
  const ctx = await asPerson(browser, null, { width: 390, height: 844 });
  const page = await ctx.newPage();
  const name = `Long${'x'.repeat(76)}`;
  await connect(page, 'read write', name);
  await page.goto('/en/app/settings/api');
  await page.locator('#connected').getByRole('button', { name: `Disconnect ${name}` }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(400);
  const overflow = await dialog.evaluate((d) => d.scrollWidth - d.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = (await dialog.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await ctx.close();
});

test('la conexión queda encontrable desde Conexiones, y el vacío lleva a cómo conectar', async ({ page }) => {
  await page.goto('/en/app/settings/connections');
  await page.getByRole('link', { name: 'Claude and other connected apps' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/api#connected/);
  await expect(page.getByRole('heading', { name: 'Connected apps' })).toBeVisible();
});

test('las pantallas se ven bien a 390 y 1280, en claro y oscuro', async ({ browser }) => {
  test.setTimeout(180_000);
  for (const width of [390, 1280]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      const tag = `${width}-${colorScheme}`;
      const ctx = await asPerson(browser, null, { width, colorScheme });
      const page = await ctx.newPage();
      const s = await startAuthorization(page, 'read write', 'Claude Code');
      await shot(page, `consent-${tag}`);
      await page.getByRole('radio', { name: /Read only/ }).focus();
      await shot(page, `consent-focus-${tag}`);
      await page.getByRole('radio', { name: /Read and write/ }).check();
      await page.getByRole('button', { name: 'Allow access' }).hover();
      await shot(page, `consent-hover-${tag}`);
      await page.getByRole('button', { name: 'Cancel' }).focus();
      await page.keyboard.press('Tab');
      await shot(page, `consent-button-focus-${tag}`);
      // Un fallo del servidor al aprobar: se dice en la pantalla y se puede reintentar.
      await page.route('**/api/oauth/consent', (r) => r.fulfill({ status: 500, body: '{}' }));
      await page.getByRole('button', { name: 'Allow access' }).click();
      await expect(page.locator('.ui-error')).toBeVisible();
      await shot(page, `consent-error-${tag}`);
      await page.unroute('**/api/oauth/consent');
      await finishAuthorization(page, s);
      await page.goto('/en/oauth/device');
      await shot(page, `device-${tag}`);
      await page.goto('/en/oauth/consent?request=expired');
      await expect(page.getByRole('heading', { name: 'This request is no longer valid' })).toBeVisible();
      await shot(page, `consent-expired-${tag}`);
      await page.goto('/en/app/settings/api');
      await expect(page.getByRole('heading', { name: 'Connected apps' })).toBeVisible();
      await shot(page, `settings-${tag}`);
      const panel = page.locator('#connected');
      await panel.screenshot({ path: SHOTS ? path.join(SHOTS, `settings-panel-${tag}.png`) : undefined });
      // La acción se ve sin scroll lateral, y el diálogo de confirmación.
      const disconnect = panel.getByRole('button', { name: /^Disconnect / }).first();
      await expect(disconnect).toBeInViewport({ ratio: 1 });
      await disconnect.click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `settings-confirm-${tag}.png`) });
      await page.keyboard.press('Escape');
      await page.goto('/en/docs/mcp');
      await shot(page, `docs-${tag}`);
      await ctx.close();
    }
  }
  // Sin conexiones, y el texto en los tres idiomas.
  const emptyEmail = `empty${uid()}@mcp.example.com`;
  const fresh = await asPerson(browser, emptyEmail);
  const freshPage = await fresh.newPage();
  await freshPage.goto('/en/app');
  // Una cuenta nueva pasa primero por el onboarding: acá ya lo hizo.
  const seedDb = db();
  await seedDb.execute({ sql: `UPDATE users SET onboarded_at = datetime('now') WHERE email = ?`, args: [emptyEmail] });
  seedDb.close();
  await freshPage.goto('/en/app/settings/api');
  await expect(freshPage.getByText('No connected apps')).toBeVisible();
  await expect(freshPage.locator('#connected').getByRole('link', { name: 'How to connect' })).toHaveAttribute('href', /\/docs\/mcp$/);
  await freshPage.locator('#connected').screenshot({ path: SHOTS ? path.join(SHOTS, 'settings-panel-empty-1280-light.png') : undefined });
  await fresh.close();
  // Los tres idiomas.
  const ctx = await asPerson(browser, null);
  const page = await ctx.newPage();
  await page.goto('/es/docs/mcp');
  await expect(page.getByRole('heading', { name: /Conectá Claude a zerosoft/ })).toBeVisible();
  await page.goto('/pt/docs/mcp');
  await expect(page.getByRole('heading', { name: /Conecte o Claude à zerosoft/ })).toBeVisible();
  await ctx.close();
});
