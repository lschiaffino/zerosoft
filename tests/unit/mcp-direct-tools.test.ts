import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createApiKey, extractBearer } from '@/lib/api-auth';
import { upsertUser } from '@/lib/db';
import { getOperation, type Operation } from '@/lib/mcp/catalog';
import { DIRECT_TOOLS, directSchema, failureHint, handleMcpPost } from '@/lib/mcp/server';
import { MCP_NAMED_TOOLS } from '@/content/mcp-docs';
import { pageRecord } from '@/lib/assistant/page-context';
import { catalogTools } from '@/lib/assistant/tools-catalog';
import { toolCtx } from '@/lib/assistant/registry';
import type { SessionUser } from '@/lib/session';
import { consentTeamId, resolveConsentWorkspace } from '@/lib/oauth/consent';
import { ensureWorkspace } from '@/lib/workspace';

process.env.NEXTAUTH_URL = 'https://zerosoft.test';
process.env.RATE_LIMIT_DISABLED = 'true';

/** Lo que recibe cada handler, sin tocar las rutas reales. */
const seen: Array<{ method: string; url: string; body: string }> = [];
vi.mock('@/lib/mcp/route-table.generated', () => ({
  ROUTE_TABLE: new Proxy(
    {},
    {
      get: () => async () => {
        const h = async (req: Request) => {
          seen.push({ method: req.method, url: req.url, body: req.method === 'GET' ? '' : await req.text() });
          return Response.json({ data: [{ id: 'c1', name: 'Ops' }] });
        };
        return { GET: h, POST: h, PATCH: h, DELETE: h };
      },
    },
  ),
}));

const uid = () => randomBytes(4).toString('hex');

async function keyFor(scopes: Parameters<typeof createApiKey>[3] = '*') {
  const id = `dt-${uid()}`;
  await upsertUser({ id, email: `${id}@example.com`, name: id, image: null });
  const { key } = await createApiKey(id, 'harness', id, scopes, true);
  return { id, key };
}

async function rpc(key: string, method: string, params?: unknown, scheme = 'Bearer') {
  const res = await handleMcpPost(
    new Request('https://zerosoft.test/api/mcp', {
      method: 'POST',
      headers: { authorization: `${scheme} ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  return { status: res.status, json: (await res.json()) as { result?: Record<string, unknown>; error?: unknown } };
}

describe('herramientas con nombre propio', () => {
  it('cada atajo apunta a una operación del catálogo y la documentación las lista todas', () => {
    for (const t of DIRECT_TOOLS) expect(getOperation(t.op), t.name).not.toBeNull();
    const core = ['whoami', 'list_workspaces', 'list_apps', 'search_operations', 'get_operation_schema', 'invoke_operation'];
    expect([...MCP_NAMED_TOOLS].sort()).toEqual([...core, ...DIRECT_TOOLS.map((t) => t.name)].sort());
  });

  it('cubren Groups, Track, Docs, Board y contactos, con descripciones en cada campo', () => {
    const names = DIRECT_TOOLS.map((t) => t.name);
    for (const n of ['list_group_chats', 'read_group_messages', 'send_group_message', 'update_group_chat', 'list_track_issues', 'update_track_issue', 'comment_on_track_issue', 'search_docs', 'get_doc_page', 'update_doc_page', 'list_boards', 'list_crm_contacts']) {
      expect(names).toContain(n);
    }
    for (const t of DIRECT_TOOLS) {
      const schema = directSchema(t, getOperation(t.op) as Operation) as { properties: Record<string, { description?: string }> };
      if (!t.inputSchema) continue;
      for (const [k, v] of Object.entries(schema.properties)) expect(v.description, `${t.name}.${k}`).toBeTruthy();
    }
  });

  it('lo destructivo pide confirm en el esquema', () => {
    const send = DIRECT_TOOLS.find((t) => t.name === 'send_group_message')!;
    expect(getOperation(send.op)?.access).toBe('destructive');
    expect((directSchema(send, getOperation(send.op)!) as { required: string[] }).required).toContain('confirm');
  });

  it('una key con MCP lista los atajos y corre uno; confirm no llega al body', async () => {
    const { key } = await keyFor();
    const list = await rpc(key, 'tools/list');
    expect(list.status).toBe(200);
    const tools = (list.json.result?.tools as Array<{ name: string }>).map((t) => t.name);
    expect(tools).toContain('send_group_message');

    seen.length = 0;
    const read = await rpc(key, 'tools/call', { name: 'list_group_chats', arguments: { q: 'ops', limit: 5 } });
    expect((read.json.result as { isError?: boolean }).isError).toBeUndefined();
    expect(seen[0].url).toContain('/api/v1/groups/chats?q=ops&limit=5');

    const blocked = await rpc(key, 'tools/call', { name: 'send_group_message', arguments: { id: 'c1', body: 'hola' } });
    expect(JSON.stringify(blocked.json.result)).toContain('confirmation_required');

    seen.length = 0;
    const sent = await rpc(key, 'tools/call', { name: 'send_group_message', arguments: { id: 'c1', body: 'hola', confirm: true } });
    expect((sent.json.result as { isError?: boolean }).isError).toBeUndefined();
    expect(seen[0].url).toContain('/api/v1/groups/chats/c1/messages');
    expect(JSON.parse(seen[0].body)).toEqual({ body: 'hola' });
  });

  it('una key sin el scope de Groups no ve sus atajos', async () => {
    const { key } = await keyFor(['track:read', 'track:write']);
    const tools = ((await rpc(key, 'tools/list')).json.result?.tools as Array<{ name: string }>).map((t) => t.name);
    expect(tools).toContain('list_track_issues');
    expect(tools).not.toContain('list_group_chats');
  });

  it('el esquema Bearer no distingue mayúsculas', async () => {
    const { key } = await keyFor();
    expect((await rpc(key, 'tools/list', undefined, 'bearer')).status).toBe(200);
    expect(extractBearer(new Request('https://x', { headers: { authorization: 'BEARER  zs_abc ' } }))).toBe('zs_abc');
    expect(extractBearer(new Request('https://x', { headers: { authorization: 'Basic abc' } }))).toBeNull();
  });

  it('los errores dicen qué hacer', () => {
    const op = getOperation('v1.track.issues.update')!;
    expect(failureHint(op, { ok: false, status: 400 })).toContain('get_operation_schema');
    expect(failureHint(op, { ok: false, status: 404 })).toContain('Look the id up');
    expect(failureHint(op, { ok: false, status: 500 })).toContain('may or may not');
    expect(failureHint(op, { ok: true, status: 200 })).toBeNull();
  });
});

describe('pantalla de permisos: el workspace propio por su id', () => {
  it('active_team_id con el id del propio se aprueba como el propio (antes: 403 y "Needs authentication")', async () => {
    const id = `cw-${uid()}`;
    const u = await upsertUser({ id, email: `${id}@example.com`, name: id, image: null });
    const own = await ensureWorkspace(u.id);
    const real = { ...u, active_team_id: own.id };
    expect(await consentTeamId(real, own.id)).toBeNull();
    expect(await resolveConsentWorkspace(real, undefined)).toBeNull();
    expect(await resolveConsentWorkspace(real, own.id)).toBeNull();
    expect(await resolveConsentWorkspace(real, 'ws_ajeno')).toBeUndefined();
  });
});

describe('asistente: el catálogo del MCP', () => {
  it('el registro abierto sale del path', () => {
    expect(pageRecord('/app/docs/abc123xyz')).toEqual({ kind: 'Docs page', id: 'abc123xyz', read: 'v1.docs.pages.get' });
    expect(pageRecord('/es/app/track/issue/ENG-12/fix-it')?.id).toBe('ENG-12');
    expect(pageRecord('/app/groups/inbox/chat_1')?.read).toBe('v1.groups.chats.get');
    expect(pageRecord('/app/docs/settings')).toBeNull();
    expect(pageRecord('/app/crm')).toBeNull();
  });

  it('lee, propone escrituras y nunca escribe en el turno', async () => {
    const id = `as-${uid()}`;
    const u = await upsertUser({ id, email: `${id}@example.com`, name: id, image: null });
    const ctx = toolCtx({ ...u, role: 'owner', apps: '*' } as SessionUser, 'en');
    const tool = (n: string) => catalogTools.find((t) => t.name === n)!;

    const found = (await (tool('find_operations') as { run: (c: unknown, i: unknown) => Promise<{ operations: Array<{ id: string }> }> }).run(ctx, { query: 'groups chats messages' })).operations.map((o) => o.id);
    expect(found).toContain('v1.groups.chats.messages.create');

    const run = tool('run_operation') as { run: (c: unknown, i: unknown) => Promise<Record<string, unknown>> };
    seen.length = 0;
    expect((await run.run(ctx, { operation: 'v1.groups.chats.list' })).ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect((await run.run(ctx, { operation: 'v1.groups.chats.messages.create', args: { path: { id: 'c1' }, body: { body: 'x' } } })).error).toBe('needs_confirmation');
    expect((await run.run(ctx, { operation: 'v1.assistant.nope' })).error).toBe('unknown_operation');

    const propose = tool('propose_operation') as { prepare: (c: unknown, i: unknown) => Promise<Record<string, unknown>> };
    expect((await propose.prepare(ctx, { operation: 'v1.groups.chats.messages.create', summary: 'Send hi' })).error).toBe('destructive_operation');
    const card = await (tool('propose_destructive_operation') as typeof propose).prepare(ctx, {
      operation: 'v1.groups.chats.messages.create',
      args: { path: { id: 'c1' }, body: { body: 'hi' } },
      summary: 'Send hi',
    });
    expect(card.confirmText).toBe('confirm');
    // La tarjeta: el título lo arma el servidor, lo del modelo va rotulado y cada campo completo.
    expect(card.summary).toBe('Groups chats messages create');
    const details = card.details as Array<{ label: string; after: string }>;
    expect(details[0]).toEqual({ label: "Assistant's summary", after: 'Send hi' });
    expect(details).toContainEqual({ label: 'body', after: 'hi' });
    // Solo lecturas (buscar el título del destino): nada se escribió.
    expect(seen.filter((s) => s.method !== 'GET')).toHaveLength(0);

    // Un texto largo llega entero a la tarjeta (la UI lo abre con un expansor).
    const long = 'x'.repeat(900);
    const big = await (tool('propose_destructive_operation') as typeof propose).prepare(ctx, {
      operation: 'v1.groups.chats.messages.create',
      args: { path: { id: 'c1' }, body: { body: long } },
      summary: 'Send a long one',
    });
    expect(big.details as Array<{ label: string; after: string }>).toContainEqual({ label: 'body', after: long });

    // run_operation devuelve el dato marcado con nonce, y una lectura no acepta adjuntos.
    const read = await run.run(ctx, { operation: 'v1.groups.chats.list' });
    expect(String(read.result)).toMatch(/^<untrusted_data source="v1.groups.chats.list" nonce="[0-9a-f]{16}">/);
    expect(await run.run(ctx, { operation: 'v1.groups.chats.list', args: { query: { q: 'attachment:att_abcdefgh12' } } })).toMatchObject({ ok: false });
  });

  it('un atajo con esquema a mano rechaza campos de más y valores fuera de lista', async () => {
    const { key } = await keyFor();
    const unread = await rpc(key, 'tools/call', { name: 'update_group_chat', arguments: { id: 'c1', read: false } });
    expect(JSON.stringify(unread.json.result)).toContain('must be one of: true');
    const extra = await rpc(key, 'tools/call', { name: 'send_group_message', arguments: { id: 'c1', body: 'hi', confirm: true, media: { url: 'https://evil.example/x.png' } } });
    expect(JSON.stringify(extra.json.result)).toContain('Unknown field');
  });
});
