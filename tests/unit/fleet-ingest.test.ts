import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; name: string; role: string; actingUser?: null; team?: null; apps?: '*' },
}));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  requireUser: async () => session.user,
  isWorkspaceAdmin: (u: { role?: string }) => u?.role === 'owner' || u?.role === 'admin',
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
}));

const ingestRoute = await import('@/app/api/fleet/ingest/route');
const waitRoute = await import('@/app/api/fleet/ingest/wait/route');
const tokensRoute = await import('@/app/api/fleet/tokens/route');
const tokenRoute = await import('@/lib/routes/fleet/tokens/[id]/route');
const sessionRoute = await import('@/lib/routes/fleet/sessions/[id]/route');
const messagesRoute = await import('@/lib/routes/fleet/sessions/[id]/messages/route');
const messageRoute = await import('@/lib/routes/fleet/sessions/[id]/messages/[messageId]/route');
const boardRoute = await import('@/app/api/fleet/board/route');
const eventsRoute = await import('@/app/api/fleet/events/route');

function req(url: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url.startsWith('http') ? url : `http://t/${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

async function asUser(label: string) {
  const u = await makeUser(label);
  session.user = { id: u.id, email: u.email, name: label, role: 'owner', actingUser: null, team: null, apps: '*' };
  return u;
}

async function newToken(label = 'Mac'): Promise<string> {
  const res = await tokensRoute.POST(req('api/fleet/tokens', 'POST', { label }));
  expect(res.status).toBe(201);
  const body = (await res.json()) as { token: string; command: string };
  expect(body.token).toMatch(/^zsf_/);
  expect(body.command).toContain('/api/fleet/install | sh -s -- zsf_');
  return body.token;
}

async function ingest(token: string, payload: Record<string, unknown>) {
  const res = await ingestRoute.POST(req('api/fleet/ingest', 'POST', payload, { authorization: `Bearer ${token}` }));
  return { status: res.status, body: (await res.json()) as { ok?: boolean; session?: string; status?: string; output?: Record<string, unknown>; error?: string } };
}

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
  session.user = null;
});

describe('Fleet: ingesta del hook', () => {
  it('sin token o con uno inválido o revocado: 401', async () => {
    await asUser('fleet-auth');
    expect((await ingest('', { event: 'Stop', session: 's' })).status).toBe(401);
    expect((await ingest('zsf_nope-nope-nope-nope-nope', { event: 'Stop', session: 's' })).status).toBe(401);
    const token = await newToken();
    expect((await ingest(token, { event: 'SessionStart', session: 's-auth', project: 'web' })).status).toBe(200);
    const list = (await (await tokensRoute.GET()).json()) as { tokens: Array<{ id: string; hint: string }> };
    // El token nunca vuelve: solo los últimos 4.
    expect(JSON.stringify(list)).not.toContain(token);
    expect(list.tokens[0].hint).toBe(token.slice(-4));
    await tokenRoute.DELETE(req('x', 'DELETE'), ctx({ id: list.tokens[0].id }));
    expect((await ingest(token, { event: 'Stop', session: 's-auth' })).status).toBe(401);
  });

  it('guarda el hash del token, nunca el token', async () => {
    const u = await asUser('fleet-hash');
    const token = await newToken();
    const rows = (await getDb().prepare('SELECT token_hash FROM fleet_tokens WHERE workspace_id = ?').all(u.id)) as Array<{ token_hash: string }>;
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].token_hash).not.toContain(token);
  });

  it('arma la sesión: prompt, trabajando, respuesta final, listo', async () => {
    await asUser('fleet-flow');
    const token = await newToken();
    const a = await ingest(token, { event: 'SessionStart', session: 'flow-1', project: 'web', branch: 'agent/fix-login', orca_pane: 'pane-7', detail: 'startup' });
    expect(a.body.output).toEqual({});
    const b = await ingest(token, { event: 'UserPromptSubmit', session: 'flow-1', project: 'web', branch: 'agent/fix-login', text: 'Fix the login redirect' });
    expect(b.body.status).toBe('working');
    await ingest(token, { event: 'Notification', session: 'flow-1', text: 'Claude needs your permission to use Bash', detail: 'permission_prompt' });
    const board1 = (await (await boardRoute.GET(req('api/fleet/board') as never)).json()) as { sessions: Array<{ status: string; title: string; orcaPane: string; unread: number }>; summary: { waiting: number } };
    expect(board1.sessions[0]).toMatchObject({ status: 'waiting', title: 'Fix the login redirect', orcaPane: 'pane-7' });
    expect(board1.summary.waiting).toBe(1);
    const c = await ingest(token, { event: 'Stop', session: 'flow-1', text: 'Done: the redirect loop is fixed.' });
    expect(c.body).toMatchObject({ status: 'done', output: {} });
    const detail = (await (await sessionRoute.GET(req(`api/fleet/sessions/${c.body.session}?read=1`) as never, ctx({ id: c.body.session! }))).json()) as {
      session: { status: string; unread: number };
      messages: Array<{ role: string; text: string }>;
    };
    expect(detail.session).toMatchObject({ status: 'done', unread: 0 });
    expect(detail.messages.map((m) => m.role)).toEqual(['notice', 'prompt', 'notice', 'agent']);
    expect(detail.messages[3].text).toContain('redirect loop');
  });

  it('aislamiento: el mismo session_id de otra persona es otra sesión, y no se ve ni se contesta', async () => {
    await asUser('fleet-iso-a');
    const tokenA = await newToken();
    const a = await ingest(tokenA, { event: 'UserPromptSubmit', session: 'same-id', project: 'secret-a', text: 'A private' });
    const b = await asUser('fleet-iso-b');
    const tokenB = await newToken();
    const bb = await ingest(tokenB, { event: 'UserPromptSubmit', session: 'same-id', project: 'b', text: 'B' });
    expect(bb.body.session).not.toBe(a.body.session);
    // B no ve la sesión de A, ni por el tablero ni por id.
    const board = (await (await boardRoute.GET(req('api/fleet/board') as never)).json()) as { sessions: Array<{ id: string; project: string }> };
    expect(board.sessions.map((s) => s.project)).toEqual(['b']);
    expect((await sessionRoute.GET(req('x') as never, ctx({ id: a.body.session! }))).status).toBe(404);
    expect((await messagesRoute.POST(req('x', 'POST', { text: 'hi' }) as never, ctx({ id: a.body.session! }))).status).toBe(404);
    expect((await sessionRoute.DELETE(req('x', 'DELETE') as never, ctx({ id: a.body.session! }))).status).toBe(404);
    // El feed de B no trae nada de A.
    const feed = (await (await eventsRoute.GET(req('api/fleet/events?cursor=1') as never)).json()) as { events: Array<{ ref: string }> };
    expect(feed.events.some((e) => e.ref === a.body.session)).toBe(false);
    // El token de B no entrega respuestas de A.
    expect(b.id).toBeTruthy();
  });
});

describe('Fleet: respuesta en cola y Stop hook', () => {
  it('la respuesta queda pendiente y el próximo Stop la entrega con decision block (una sola vez)', async () => {
    await asUser('fleet-reply');
    const token = await newToken();
    const s = await ingest(token, { event: 'UserPromptSubmit', session: 'reply-1', project: 'web', text: 'Build the page' });
    const id = s.body.session!;
    const posted = await messagesRoute.POST(req('x', 'POST', { text: 'Also add a test for it' }) as never, ctx({ id }));
    expect(posted.status).toBe(201);
    const msg = ((await posted.json()) as { message: { id: string; status: string } }).message;
    expect(msg.status).toBe('pending');

    const stop = await ingest(token, { event: 'Stop', session: 'reply-1', text: 'Page built.', stop_hook_active: false });
    expect(stop.body.output).toEqual({ decision: 'block', reason: 'Also add a test for it' });
    expect(stop.body.status).toBe('working');

    // Entregada: no vuelve a salir en el siguiente Stop.
    const again = await ingest(token, { event: 'Stop', session: 'reply-1', text: 'Test added.', stop_hook_active: true });
    expect(again.body.output).toEqual({});

    const detail = (await (await sessionRoute.GET(req('x') as never, ctx({ id }))).json()) as { messages: Array<{ id: string; role: string; status: string; deliveredAt: string | null }> };
    const reply = detail.messages.find((m) => m.id === msg.id)!;
    expect(reply.status).toBe('delivered');
    expect(reply.deliveredAt).toBeTruthy();
  });

  it('con el agente quieto, el próximo prompt la suma como contexto', async () => {
    await asUser('fleet-ups');
    const token = await newToken();
    const s = await ingest(token, { event: 'Stop', session: 'ups-1', project: 'web', text: 'Waiting.' });
    await messagesRoute.POST(req('x', 'POST', { text: 'Check mobile too' }) as never, ctx({ id: s.body.session! }));
    const p = await ingest(token, { event: 'UserPromptSubmit', session: 'ups-1', text: 'continue' });
    const out = p.body.output as { hookSpecificOutput?: { hookEventName: string; additionalContext: string } };
    expect(out.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit');
    expect(out.hookSpecificOutput?.additionalContext).toContain('Check mobile too');
  });

  it('el modo espera entrega la respuesta que llega mientras espera', async () => {
    await asUser('fleet-wait');
    const token = await newToken();
    const s = await ingest(token, { event: 'Stop', session: 'wait-1', project: 'web', text: 'Should I deploy?' });
    const waiting = waitRoute.POST(req('api/fleet/ingest/wait', 'POST', { session: 'wait-1', ms: 4000 }, { authorization: `Bearer ${token}` }));
    await new Promise((r) => setTimeout(r, 300));
    await messagesRoute.POST(req('x', 'POST', { text: 'Yes, deploy' }) as never, ctx({ id: s.body.session! }));
    const res = await waiting;
    expect(((await res.json()) as { output: unknown }).output).toEqual({ decision: 'block', reason: 'Yes, deploy' });
  });

  it('sacar de la cola una respuesta pendiente; una entregada ya no se puede', async () => {
    await asUser('fleet-cancel');
    const token = await newToken();
    const s = await ingest(token, { event: 'UserPromptSubmit', session: 'c-1', project: 'web', text: 'x' });
    const id = s.body.session!;
    const m1 = ((await (await messagesRoute.POST(req('x', 'POST', { text: 'one' }) as never, ctx({ id }))).json()) as { message: { id: string } }).message;
    expect((await messageRoute.DELETE(req('x', 'DELETE') as never, ctx({ id, messageId: m1.id }))).status).toBe(200);
    const stop = await ingest(token, { event: 'Stop', session: 'c-1', text: 'ok' });
    expect(stop.body.output).toEqual({});
    const m2 = ((await (await messagesRoute.POST(req('x', 'POST', { text: 'two' }) as never, ctx({ id }))).json()) as { message: { id: string } }).message;
    await ingest(token, { event: 'Stop', session: 'c-1', text: 'ok' });
    expect((await messageRoute.DELETE(req('x', 'DELETE') as never, ctx({ id, messageId: m2.id }))).status).toBe(409);
  });

  it('renombrar, archivar y borrar una sesión', async () => {
    await asUser('fleet-crud');
    const token = await newToken();
    const s = await ingest(token, { event: 'UserPromptSubmit', session: 'crud-1', project: 'web', text: 'x' });
    const id = s.body.session!;
    const renamed = (await (await sessionRoute.PATCH(req('x', 'PATCH', { title: 'Login fix' }) as never, ctx({ id }))).json()) as { session: { title: string } };
    expect(renamed.session.title).toBe('Login fix');
    await sessionRoute.PATCH(req('x', 'PATCH', { archived: true }) as never, ctx({ id }));
    const board = (await (await boardRoute.GET(req('api/fleet/board') as never)).json()) as { sessions: unknown[] };
    expect(board.sessions).toHaveLength(0);
    const archived = (await (await boardRoute.GET(req('api/fleet/board?archived=1') as never)).json()) as { sessions: Array<{ id: string }> };
    expect(archived.sessions.map((x) => x.id)).toEqual([id]);
    // Un evento nuevo la saca del archivo.
    await ingest(token, { event: 'Stop', session: 'crud-1', text: 'done' });
    expect(((await (await boardRoute.GET(req('api/fleet/board') as never)).json()) as { sessions: unknown[] }).sessions).toHaveLength(1);
    expect((await sessionRoute.DELETE(req('x', 'DELETE') as never, ctx({ id }))).status).toBe(200);
    expect((await sessionRoute.GET(req('x') as never, ctx({ id }))).status).toBe(404);
  });
});
