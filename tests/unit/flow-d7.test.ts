import { generateKeyPairSync, createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createAgent } from '@/lib/agents';
import { setAiModelOverride } from '@/lib/ai';
import {
  createFlow,
  getFlow,
  getRunWithSteps,
  listFlowVersions,
  listFlowWebhooks,
  restoreFlowVersion,
  updateFlow,
} from '@/lib/flow';
import { setFlowCodeRunnerForTests } from '@/lib/flow-code';
import {
  createCredential,
  decryptCredential,
  encryptCredential,
  getCredential,
  listCredentials,
  resolveCredential,
  updateCredential,
} from '@/lib/flow-credentials';
import { REDACTED, redact } from '@/lib/flow-credentials-schema';
import { rerunFromStep } from '@/lib/flow-engine';
import { runFlowNow } from '@/lib/flow-http';
import { verifyStripeSignature } from '@/lib/flow-integrations';
import { diffGraphs, FLOW_TEMPLATES, nodeOutputs, validateGraph, type FlowGraph } from '@/lib/flow-schema';
import { processFlowQueue } from '@/lib/flow-worker';
import { GMAIL_SEND_SCOPE } from '@/lib/gmail';
import { upsertIntegration } from '@/lib/integrations';
import { makeUser } from './helpers';
import { mockModel } from './ai-mock';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const credsRoute = await import('@/app/api/flow/credentials/route');
const credRoute = await import('@/app/api/flow/credentials/[id]/route');
const hookRoute = await import('@/app/api/flow/hooks/[token]/route');
const rerunRoute = await import('@/app/api/flow/runs/[id]/rerun/route');

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('FLOW_WORKER_KICK', 'false');
  // Las APIs de terceros se mockean: sin DNS real.
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setAiModelOverride(null);
  setFlowCodeRunnerForTests(undefined);
  session.user = null;
});

// ---------- helpers ----------

function node(id: string, type: string, config: Record<string, unknown> = {}) {
  return { id, type, position: { x: 0, y: 0 }, config } as FlowGraph['nodes'][number];
}

function edge(source: string, target: string, sourceHandle?: string) {
  return { id: `${source}-${sourceHandle ?? 'out'}-${target}`, source, target, sourceHandle: sourceHandle ?? null };
}

function manual(nodes: FlowGraph['nodes'], edges: FlowGraph['edges']): FlowGraph {
  return { nodes: [node('t', 'trigger.manual', { sample: '{}' }), ...nodes], edges };
}

async function newFlow(ws: string, graph: FlowGraph, name = 'F') {
  const res = await createFlow(ws, ws, { name, graph });
  if (!res.ok) throw new Error(`${res.error} ${res.nodeId ?? ''}`);
  return res.flow;
}

async function run(ws: string, graph: FlowGraph, input: Record<string, unknown> = {}) {
  const flow = await newFlow(ws, graph);
  const res = await runFlowNow(ws, flow.id, input);
  if (!res.ok || !res.run) throw new Error('run failed to start');
  return { flow, run: res.run };
}

function step(r: { steps: Array<{ nodeId: string }> } | null, id: string) {
  return (r?.steps ?? []).filter((s) => s.nodeId === id).at(-1) as
    | { nodeId: string; status: string; input: unknown; output: unknown; error: string | null }
    | undefined;
}

type Call = { url: string; init: RequestInit };

/** fetch falso: cada handler recibe la URL y responde (o null para seguir). */
function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = String(input instanceof URL ? input.href : input);
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>;
}

async function cred(ws: string, name: string, type: string, data: Record<string, string>) {
  const res = await createCredential(ws, ws, { name, type, data });
  if (!res.ok) throw new Error(res.error);
  return res.credential;
}

// ---------- Credenciales ----------

describe('Flow: credenciales', () => {
  it('cifra con AES-256-GCM y solo descifra en el mismo workspace (AAD)', () => {
    const sealed = encryptCredential('ws-a', 'c1', { value: 'super-secret-token' });
    expect(sealed.startsWith('cred:v1:')).toBe(true);
    expect(sealed).not.toContain('super-secret-token');
    expect(decryptCredential('ws-a', 'c1', sealed)).toEqual({ value: 'super-secret-token' });
    expect(decryptCredential('ws-b', 'c1', sealed)).toBeNull();
    expect(decryptCredential('ws-a', 'c2', sealed)).toBeNull();
    // Otra clave: no se puede leer.
    vi.stubEnv('CREDENTIALS_KEY', 'another-key');
    expect(decryptCredential('ws-a', 'c1', sealed)).toBeNull();
  });

  it('CRUD aislado por workspace; los secretos nunca vuelven en claro', async () => {
    const a = (await makeUser('cred')).id;
    const b = (await makeUser('cred')).id;
    const c = await cred(a, 'crm-api', 'api_key', { headerName: 'X-Api-Key', value: 'sk_live_abcdef123456' });
    expect(c).toMatchObject({ name: 'crm-api', type: 'api_key', fields: { headerName: 'X-Api-Key' }, secretsSet: ['value'], hint: '••••3456' });
    expect(JSON.stringify(await listCredentials(a))).not.toContain('sk_live_abcdef123456');
    const row = (await getDb().prepare('SELECT data FROM flow_credentials WHERE id = ?').get(c.id)) as { data: string };
    expect(row.data).not.toContain('sk_live');

    expect(await listCredentials(b)).toEqual([]);
    expect(await getCredential(b, c.id)).toBeNull();
    expect(await resolveCredential(b, c.id)).toBeNull();
    expect(await resolveCredential(b, 'crm-api')).toBeNull();
    expect((await resolveCredential(a, 'crm-api'))?.data.value).toBe('sk_live_abcdef123456');
    // Una fila copiada a otro workspace no se descifra.
    await getDb()
      .prepare("INSERT INTO flow_credentials (id, user_id, name, type, data, hint, created_at, updated_at) VALUES (?, ?, 'stolen', 'api_key', ?, '', '', '')")
      .run('stolen-1', b, row.data);
    expect(await resolveCredential(b, 'stolen')).toBeNull();

    // Secreto vacío al editar = se conserva; nombre duplicado = error.
    const up = await updateCredential(a, c.id, { data: { headerName: 'Authorization', value: '' } });
    expect(up.ok && up.credential.fields.headerName).toBe('Authorization');
    expect((await resolveCredential(a, c.id))?.data.value).toBe('sk_live_abcdef123456');
    await cred(a, 'other', 'basic', { username: 'u', password: 'p4ssw0rd!' });
    expect(await updateCredential(a, c.id, { name: 'other' })).toMatchObject({ ok: false, error: 'duplicate_name' });
    expect(await createCredential(a, a, { name: 'bad name', type: 'basic', data: {} })).toMatchObject({ ok: false, error: 'invalid_name' });
    expect(await createCredential(a, a, { name: 'g', type: 'google', data: { serviceAccountJson: '{"x":1}' } })).toMatchObject({
      ok: false,
      error: 'invalid_json',
    });
  });

  it('API: miembros ven la lista sin secretos; solo admins crean', async () => {
    const owner = await makeUser('credapi');
    session.user = { ...owner, role: 'member' };
    const denied = await credsRoute.POST(
      new NextRequest('http://localhost/api/flow/credentials', {
        method: 'POST',
        body: JSON.stringify({ name: 'x', type: 'telegram', data: { botToken: '1:abc' } }),
      }),
    );
    expect(denied.status).toBe(403);
    session.user = { ...owner, role: 'owner' };
    const created = await credsRoute.POST(
      new NextRequest('http://localhost/api/flow/credentials', {
        method: 'POST',
        body: JSON.stringify({ name: 'tg', type: 'telegram', data: { botToken: '123456:SECRETSECRETSECRETSECRET' } }),
      }),
    );
    expect(created.status).toBe(201);
    const body = await created.text();
    expect(body).not.toContain('SECRETSECRET');
    const { credential } = JSON.parse(body) as { credential: { id: string } };
    const list = await (await credsRoute.GET()).text();
    expect(list).toContain('"tg"');
    expect(list).not.toContain('SECRETSECRET');
    const del = await credRoute.DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), {
      params: Promise.resolve({ id: credential.id }),
    });
    expect(del.status).toBe(200);
  });

  it('redacta los valores en pasos, errores y contexto de la corrida', async () => {
    const ws = (await makeUser('redact')).id;
    const c = await cred(ws, 'api', 'api_key', { headerName: 'Authorization', prefix: 'Bearer', value: 'tok_very_secret_42' });
    // La API devuelve el header recibido (y falla con 401 la segunda vez).
    let n = 0;
    mockFetch((_url, init) => {
      n += 1;
      const auth = headersOf(init).authorization;
      return n === 1 ? json({ youSent: auth }) : json({ error: `bad token ${auth}` }, 401);
    });
    const graph = manual(
      [
        node('http', 'action.http', { method: 'GET', url: 'https://api.example.test/me', credentialId: c.id }),
        node('echo', 'data.set', { fields: [{ key: 'v', value: '{{nodes.http.output.body.youSent}}' }] }),
        node('again', 'action.http', { method: 'GET', url: 'https://api.example.test/fail', credentialId: 'api' }),
      ],
      [edge('t', 'http'), edge('http', 'echo'), edge('echo', 'again')],
    );
    const { run: r } = await run(ws, graph);
    expect(r.status).toBe('failed');
    const all = JSON.stringify(r);
    expect(all).not.toContain('tok_very_secret_42');
    expect(step(r, 'http')?.output).toMatchObject({ body: { youSent: `Bearer ${REDACTED}` } });
    expect(step(r, 'echo')?.output).toEqual({ v: `Bearer ${REDACTED}` });
    const ctx = (await getDb().prepare('SELECT context FROM flow_runs WHERE id = ?').get(r.id)) as { context: string };
    expect(ctx.context).not.toContain('tok_very_secret_42');
    expect(redact({ a: ['x tok_very_secret_42 y'] }, ['tok_very_secret_42'])).toEqual({ a: [`x ${REDACTED} y`] });
  });

  it('una credencial de otro workspace o de otro tipo no se usa', async () => {
    const a = (await makeUser('cx')).id;
    const b = (await makeUser('cx')).id;
    const foreign = await cred(b, 'slack', 'slack', { webhookUrl: 'https://hooks.slack.com/services/T/B/X' });
    const own = await cred(a, 'tg', 'telegram', { botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWX' });
    mockFetch(() => json({ ok: true }));
    const { run: r1 } = await run(a, manual([node('s', 'app.slack', { credentialId: foreign.id, text: 'hi' })], [edge('t', 's')]));
    expect(step(r1, 's')?.error).toBe('credential_not_found');
    const { run: r2 } = await run(a, manual([node('s', 'app.slack', { credentialId: own.id, text: 'hi' })], [edge('t', 's')]));
    expect(step(r2, 's')?.error).toBe('credential_wrong_type');
  });
});

// ---------- Integraciones ----------

describe('Flow: integraciones (fetch mockeado)', () => {
  it('Slack: bot token (chat.postMessage) y webhook entrante', async () => {
    const ws = (await makeUser('slack')).id;
    const bot = await cred(ws, 'slackbot', 'slack', { botToken: 'xoxb-1234-secret' });
    const hook = await cred(ws, 'slackhook', 'slack', { webhookUrl: 'https://hooks.slack.com/services/T0/B0/XYZ' });
    const calls = mockFetch((url) => (url.includes('chat.postMessage') ? json({ ok: true, ts: '1.2', channel: 'C1' }) : new Response('ok')));
    const graph = manual(
      [
        node('a', 'app.slack', { credentialId: bot.id, channel: '#sales', text: 'Lead: {{trigger.email}}' }),
        node('b', 'app.slack', { credentialId: hook.id, text: 'Hook: {{trigger.email}}' }),
      ],
      [edge('t', 'a'), edge('a', 'b')],
    );
    const { run: r } = await run(ws, graph, { email: 'ada@example.com' });
    expect(r.status).toBe('success');
    expect(calls[0].url).toBe('https://slack.com/api/chat.postMessage');
    expect(headersOf(calls[0].init).authorization).toBe('Bearer xoxb-1234-secret');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ channel: '#sales', text: 'Lead: ada@example.com' });
    expect(step(r, 'a')?.output).toMatchObject({ ok: true, via: 'bot', ts: '1.2' });
    expect(calls[1].url).toBe('https://hooks.slack.com/services/T0/B0/XYZ');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ text: 'Hook: ada@example.com' });

    mockFetch(() => json({ ok: false, error: 'channel_not_found' }));
    const { run: bad } = await run(ws, manual([node('a', 'app.slack', { credentialId: bot.id, channel: '#x', text: 'x' })], [edge('t', 'a')]));
    expect(step(bad, 'a')?.error).toBe('slack_channel_not_found');
  });

  it('Google Sheets: append con token, lectura y cuenta de servicio (JWT)', async () => {
    const ws = (await makeUser('sheets')).id;
    const tok = await cred(ws, 'gtoken', 'google', { accessToken: 'ya29.secret-token' });
    const calls = mockFetch((url, init) => {
      if (url.includes(':append')) return json({ updates: { updatedRange: 'Leads!A2:C2', updatedRows: 1 } });
      if (url === 'https://oauth2.googleapis.com/token') {
        const assertion = new URLSearchParams(String(init.body)).get('assertion') ?? '';
        return assertion.split('.').length === 3 ? json({ access_token: 'ya29.from-sa', expires_in: 3600 }) : json({}, 400);
      }
      return json({ range: 'Leads!A1:C3', values: [['email', 'name'], ['a@x.co', 'Ada'], ['b@x.co', 'Bob']] });
    });
    const sheetId = '1AbCdEfGhIjKlMnOpQrStUvWxYz';
    const { run: r } = await run(
      ws,
      manual(
        [
          node('add', 'app.google_sheets', {
            credentialId: tok.id,
            operation: 'append',
            spreadsheetId: sheetId,
            range: 'Leads',
            row: [
              { key: 'email', value: '{{trigger.email}}' },
              { key: 'n', value: '{{trigger.n}}' },
            ],
          }),
          node('read', 'app.google_sheets', { credentialId: tok.id, operation: 'read', spreadsheetId: sheetId, range: 'Leads' }),
        ],
        [edge('t', 'add'), edge('add', 'read')],
      ),
      { email: 'ada@example.com', n: 3 },
    );
    expect(r.status).toBe('success');
    expect(calls[0].url).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Leads:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ values: [['ada@example.com', 3]] });
    expect(headersOf(calls[0].init).authorization).toBe('Bearer ya29.secret-token');
    expect(step(r, 'read')?.output).toMatchObject({ count: 2, rows: [{ email: 'a@x.co', name: 'Ada' }, { email: 'b@x.co', name: 'Bob' }] });

    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const sa = await cred(ws, 'gsa', 'google', {
      serviceAccountJson: JSON.stringify({
        type: 'service_account',
        client_email: 'bot@proj.iam.gserviceaccount.com',
        private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      }),
    });
    const { run: r2 } = await run(
      ws,
      manual([node('read', 'app.google_sheets', { credentialId: sa.id, operation: 'read', spreadsheetId: sheetId, range: 'A1:B2' })], [edge('t', 'read')]),
    );
    expect(r2.status).toBe('success');
    expect(headersOf(calls.at(-1)!.init).authorization).toBe('Bearer ya29.from-sa');
    // El token emitido tampoco queda en los pasos.
    expect(JSON.stringify(r2)).not.toContain('ya29.from-sa');
  });

  it('Gmail: envía con la cuenta conectada del CRM; sin conexión falla claro', async () => {
    const ws = (await makeUser('gmail')).id;
    const graph = manual([node('mail', 'app.gmail', { to: '{{trigger.to}}', subject: 'Hi', body: 'Hello {{trigger.name}}' })], [edge('t', 'mail')]);
    const { run: off } = await run(ws, graph, { to: 'ada@example.com', name: 'Ada' });
    expect(step(off, 'mail')?.error).toBe('gmail_not_connected');

    await upsertIntegration({
      userId: ws,
      provider: 'gmail',
      email: 'me@company.test',
      accessToken: 'gmail-access-token',
      refreshToken: '',
      expiresAt: Date.now() + 3_600_000,
      scope: GMAIL_SEND_SCOPE,
    });
    const calls = mockFetch(() => json({ id: 'm1', threadId: 't1' }));
    const { run: r } = await run(ws, graph, { to: 'ada@example.com', name: 'Ada' });
    expect(r.status).toBe('success');
    expect(calls[0].url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    const raw = (JSON.parse(String(calls[0].init.body)) as { raw: string }).raw;
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    expect(mime).toContain('To: ada@example.com');
    expect(mime).toContain('From: me@company.test');
    expect(step(r, 'mail')?.output).toMatchObject({ sent: true, id: 'm1', from: 'me@company.test' });
    expect(JSON.stringify(r)).not.toContain('gmail-access-token');
  });

  it('Stripe: crea clientes (idempotente) y lista pagos', async () => {
    const ws = (await makeUser('stripe')).id;
    const sc = await cred(ws, 'stripe', 'stripe', { secretKey: 'sk_test_51SECRET' });
    const calls = mockFetch((url) =>
      url.includes('/customers')
        ? json({ id: 'cus_1', email: 'ada@example.com', name: 'Ada' })
        : json({ data: [{ id: 'pi_1', amount: 1000, currency: 'usd', status: 'succeeded', created: 1, extra: 'x' }] }),
    );
    const { run: r } = await run(
      ws,
      manual(
        [
          node('cust', 'app.stripe', { credentialId: sc.id, operation: 'create_customer', email: '{{trigger.email}}', name: 'Ada' }),
          node('pays', 'app.stripe', { credentialId: sc.id, operation: 'list_payments', limit: 5 }),
        ],
        [edge('t', 'cust'), edge('cust', 'pays')],
      ),
      { email: 'ada@example.com' },
    );
    expect(r.status).toBe('success');
    expect(calls[0].url).toBe('https://api.stripe.com/v1/customers');
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(form.get('email')).toBe('ada@example.com');
    expect(headersOf(calls[0].init)['idempotency-key']).toBe(`${r.id}:cust`);
    expect(headersOf(calls[0].init).authorization).toBe('Bearer sk_test_51SECRET');
    expect(step(r, 'cust')?.output).toEqual({ customer: { id: 'cus_1', email: 'ada@example.com', name: 'Ada' } });
    expect(calls[1].url).toBe('https://api.stripe.com/v1/payment_intents?limit=5');
    expect(step(r, 'pays')?.output).toMatchObject({ count: 1, payments: [{ id: 'pi_1', amount: 1000 }] });

    mockFetch(() => json({ error: { type: 'invalid_request_error', code: 'email_invalid' } }, 400));
    const { run: bad } = await run(ws, manual([node('c', 'app.stripe', { credentialId: sc.id, email: 'x@y.co' })], [edge('t', 'c')]));
    expect(step(bad, 'c')?.error).toBe('stripe_email_invalid');
  });

  it('Stripe: el trigger verifica la firma del webhook y filtra eventos', async () => {
    const ws = (await makeUser('stripehook')).id;
    const sc = await cred(ws, 'stripe', 'stripe', { secretKey: 'sk_test_x', webhookSecret: 'whsec_test_secret' });
    const flow = await newFlow(ws, {
      nodes: [
        node('t', 'trigger.stripe', { credentialId: sc.id, events: 'payment_intent.*' }),
        node('s', 'data.set', { fields: [{ key: 'amount', value: '{{trigger.data.object.amount}}' }] }),
      ],
      edges: [edge('t', 's')],
    });
    await updateFlow(ws, flow.id, { enabled: true });
    const [{ token }] = await listFlowWebhooks(ws, flow.id);
    const post = (payload: object, secret = 'whsec_test_secret', ts = Math.floor(Date.now() / 1000)) => {
      const raw = JSON.stringify(payload);
      const sig = createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
      return hookRoute.POST(
        new NextRequest(`http://localhost/api/flow/hooks/${token}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` },
          body: raw,
        }),
        { params: Promise.resolve({ token }) },
      );
    };
    const event = { id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', amount: 4200 } } };
    expect((await post(event, 'whsec_wrong')).status).toBe(400);
    expect((await post(event, 'whsec_test_secret', Math.floor(Date.now() / 1000) - 3600)).status).toBe(400);
    expect((await post({ ...event, type: 'customer.created' })).status).toBe(200);
    const ok = await post(event);
    expect(ok.status).toBe(202);
    const { runId } = (await ok.json()) as { runId: string };
    await processFlowQueue();
    const r = await getRunWithSteps(ws, runId);
    expect(r?.status).toBe('success');
    expect(step(r, 's')?.output).toEqual({ amount: 4200 });
    expect(verifyStripeSignature('{}', 't=1,v1=00', 'whsec')).toBe(false);
  });

  it('Notion (página en base y texto), Discord y Telegram', async () => {
    const ws = (await makeUser('apps')).id;
    const nc = await cred(ws, 'notion', 'notion', { token: 'ntn_secret_123' });
    const dc = await cred(ws, 'discord', 'discord', { webhookUrl: 'https://discord.com/api/webhooks/1/abc' });
    const tc = await cred(ws, 'tg', 'telegram', { botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWX' });
    const calls = mockFetch((url) => {
      if (url === 'https://api.notion.com/v1/pages') return json({ id: 'page-1', url: 'https://notion.so/page-1' });
      if (url.includes('/blocks/')) return json({ results: [{}, {}] });
      if (url.includes('discord.com')) return json({ id: 'msg1', channel_id: 'ch1' });
      return json({ ok: true, result: { message_id: 77, chat: { id: -100 } } });
    });
    const dbId = '0123456789abcdef0123456789abcdef';
    const { run: r } = await run(
      ws,
      manual(
        [
          node('page', 'app.notion', {
            credentialId: nc.id,
            operation: 'create_page',
            databaseId: `https://www.notion.so/acme/${dbId}?v=1`,
            title: 'Call with {{trigger.name}}',
            properties: '{"Status": {"select": {"name": "New"}}}',
            content: 'First\n\nSecond',
          }),
          node('append', 'app.notion', { credentialId: nc.id, operation: 'append_text', pageId: dbId, content: 'A\n\nB' }),
          node('dc', 'app.discord', { credentialId: dc.id, content: 'Hi {{trigger.name}}', username: 'Bot' }),
          node('tg', 'app.telegram', { credentialId: tc.id, chatId: '-1001', text: 'Hi {{trigger.name}}', parseMode: 'HTML' }),
        ],
        [edge('t', 'page'), edge('page', 'append'), edge('append', 'dc'), edge('dc', 'tg')],
      ),
      { name: 'Ada' },
    );
    expect(r.status).toBe('success');
    const page = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(page).toMatchObject({
      parent: { database_id: dbId },
      properties: { Status: { select: { name: 'New' } }, Name: { title: [{ text: { content: 'Call with Ada' } }] } },
    });
    expect((page.children as unknown[]).length).toBe(2);
    expect(headersOf(calls[0].init)['notion-version']).toBe('2022-06-28');
    expect(calls[1].url).toBe(`https://api.notion.com/v1/blocks/${dbId}/children`);
    expect(calls[1].init.method).toBe('PATCH');
    expect(calls[2].url).toBe('https://discord.com/api/webhooks/1/abc?wait=true');
    expect(JSON.parse(String(calls[2].init.body))).toMatchObject({ content: 'Hi Ada', username: 'Bot' });
    expect(calls[3].url).toBe('https://api.telegram.org/bot123456:ABCDEFGHIJKLMNOPQRSTUVWX/sendMessage');
    expect(JSON.parse(String(calls[3].init.body))).toEqual({ chat_id: '-1001', text: 'Hi Ada', parse_mode: 'HTML' });
    expect(step(r, 'tg')?.output).toMatchObject({ sent: true, messageId: 77 });
    expect(JSON.stringify(r)).not.toContain('ABCDEFGHIJKLMNOPQRSTUVWX');

    // Telegram responde 400: el error no expone el token (va en la URL).
    mockFetch(() => json({ ok: false, description: 'Bad Request: chat not found' }, 400));
    const { run: bad } = await run(ws, manual([node('tg', 'app.telegram', { credentialId: tc.id, chatId: '1', text: 'x' })], [edge('t', 'tg')]));
    expect(step(bad, 'tg')?.error).toBe('telegram_400');
    expect(JSON.stringify(bad)).not.toContain('ABCDEFGHIJKLMNOPQRSTUVWX');
  });

  it('valida la config de cada nodo con zod antes de llamar', async () => {
    const ws = (await makeUser('zod')).id;
    const tc = await cred(ws, 'tg', 'telegram', { botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWX' });
    const calls = mockFetch(() => json({ ok: true }));
    const { run: r } = await run(ws, manual([node('tg', 'app.telegram', { credentialId: tc.id, chatId: 'not a chat', text: 'x' })], [edge('t', 'tg')]));
    expect(step(r, 'tg')?.error).toBe('missing_chatid');
    const { run: r2 } = await run(ws, manual([node('s', 'app.google_sheets', { credentialId: tc.id, spreadsheetId: 'bad id!' })], [edge('t', 's')]));
    expect(step(r2, 's')?.error).toBe('missing_spreadsheetid');
    expect(calls).toHaveLength(0);
  });
});

// ---------- Errores ----------

describe('Flow: manejo de errores', () => {
  it('continue on fail sigue por la salida normal; branch sale por error', async () => {
    const ws = (await makeUser('onerr')).id;
    mockFetch(() => new Response('nope', { status: 404 }));
    const graph = manual(
      [
        node('a', 'action.http', { method: 'GET', url: 'https://x.test/a', onError: 'continue' }),
        node('after_a', 'data.set', { fields: [{ key: 'err', value: '{{nodes.a.output.error}}' }] }),
        node('b', 'action.http', { method: 'GET', url: 'https://x.test/b', onError: 'branch' }),
        node('ok_b', 'data.set', { fields: [{ key: 'x', value: '1' }] }),
        node('err_b', 'data.set', { fields: [{ key: 'status', value: '{{nodes.b.output.status}}' }] }),
      ],
      [edge('t', 'a'), edge('a', 'after_a'), edge('after_a', 'b'), edge('b', 'ok_b'), edge('b', 'err_b', 'error')],
    );
    expect(validateGraph(graph).ok).toBe(true);
    expect(nodeOutputs(graph.nodes.find((n) => n.id === 'b')!)).toEqual(['out', 'error']);
    // Sin rama de error, la salida 'error' no es válida.
    expect(
      validateGraph(manual([node('c', 'action.http'), node('d', 'data.set')], [edge('t', 'c'), edge('c', 'd', 'error')])),
    ).toMatchObject({ ok: false, error: 'invalid_handle' });
    const { run: r } = await run(ws, graph);
    expect(r.status).toBe('success');
    expect(step(r, 'a')).toMatchObject({ status: 'failed', error: 'http_404' });
    expect(step(r, 'after_a')?.output).toEqual({ err: 'http_404' });
    expect(step(r, 'ok_b')).toBeUndefined();
    expect(step(r, 'err_b')?.output).toEqual({ status: 404 });
  });

  it('flow de error: corre otro flow con los detalles cuando una corrida falla', async () => {
    const ws = (await makeUser('errflow')).id;
    const handler = await newFlow(ws, manual([node('log', 'data.set', { fields: [{ key: 'msg', value: '{{trigger.flow.name}} failed: {{trigger.run.error}}' }] })], [edge('t', 'log')]), 'Handler');
    const main = await newFlow(ws, manual([node('boom', 'data.json_parse', { text: 'not json' })], [edge('t', 'boom')]), 'Main');
    expect(await updateFlow(ws, main.id, { errorFlowId: main.id })).toMatchObject({ ok: false, error: 'invalid_error_flow' });
    const other = (await makeUser('errflow')).id;
    const foreign = await newFlow(other, manual([], []));
    expect(await updateFlow(ws, main.id, { errorFlowId: foreign.id })).toMatchObject({ ok: false, error: 'invalid_error_flow' });
    expect((await updateFlow(ws, main.id, { errorFlowId: handler.id })).ok).toBe(true);

    const res = await runFlowNow(ws, main.id, {});
    expect(res.ok && res.run?.status).toBe('failed');
    await processFlowQueue();
    const runs = (await getDb().prepare('SELECT id, trigger_type, parent_run_id FROM flow_runs WHERE flow_id = ?').all(handler.id)) as Array<{
      id: string;
      trigger_type: string;
      parent_run_id: string;
    }>;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger_type: 'error', parent_run_id: res.ok ? res.run!.id : '' });
    const hr = await getRunWithSteps(ws, runs[0].id);
    expect(step(hr, 'log')?.output).toEqual({ msg: 'Main failed: boom: invalid_json' });
    expect(hr?.input).toMatchObject({ failedNode: { id: 'boom', type: 'data.json_parse' } });
  });

  it('re-ejecuta desde un paso reusando las salidas anteriores', async () => {
    const ws = (await makeUser('rerun')).id;
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      return json({ n: calls });
    });
    const graph = manual(
      [
        node('fetch', 'action.http', { method: 'GET', url: 'https://x.test/n' }),
        node('parse', 'data.json_parse', { text: '{{trigger.raw}}' }),
        node('use', 'data.set', { fields: [{ key: 'n', value: '{{nodes.fetch.output.body.n}}' }, { key: 'p', value: '{{nodes.parse.output.ok}}' }] }),
      ],
      [edge('t', 'fetch'), edge('fetch', 'parse'), edge('parse', 'use')],
    );
    const { flow, run: first } = await run(ws, graph, { raw: '{bad' });
    expect(first.status).toBe('failed');
    expect(calls).toBe(1);
    // Se arregla el nodo (ahora parsea un texto fijo) y se re-ejecuta desde ahí.
    await updateFlow(ws, flow.id, {
      graph: { ...graph, nodes: graph.nodes.map((n) => (n.id === 'parse' ? { ...n, config: { text: '{"ok": true}' } } : n)) },
    });
    const re = await rerunFromStep(ws, first.id, 'parse');
    expect(re).toMatchObject({ ok: true, status: 'success' });
    expect(calls).toBe(1); // el HTTP no se repitió
    const r = await getRunWithSteps(ws, re.ok ? re.runId : '');
    expect(r?.rerunOf).toBe(first.id);
    expect(step(r, 'use')?.output).toEqual({ n: 1, p: true });
    expect(r?.steps.map((s) => s.nodeId)).toEqual(['t', 'fetch', 'parse', 'use']);

    expect(await rerunFromStep(ws, first.id, 't')).toEqual({ ok: false, error: 'node_is_trigger' });
    expect(await rerunFromStep(ws, first.id, 'ghost')).toEqual({ ok: false, error: 'node_not_found' });
    const other = (await makeUser('rerun')).id;
    expect(await rerunFromStep(other, first.id, 'parse')).toEqual({ ok: false, error: 'not_found' });

    session.user = { ...(await makeUser('x')), id: ws, role: 'admin' };
    const viaApi = await rerunRoute.POST(
      new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify({ fromNodeId: 'use' }) }),
      { params: Promise.resolve({ id: first.id }) },
    );
    expect(viaApi.status).toBe(200);
    expect(((await viaApi.json()) as { run: { status: string } }).run.status).toBe('success');
  });
});

// ---------- Nodos nuevos ----------

describe('Flow: agente, código, merge y sub-flow', () => {
  it('Ejecutar agente: manda el texto y devuelve la respuesta', async () => {
    const ws = (await makeUser('agentnode')).id;
    const agent = await createAgent(ws, ws, { name: 'Helper' });
    setAiModelOverride(mockModel('Our hours are 9 to 5.'));
    const { run: r } = await run(
      ws,
      manual([node('ag', 'ai.agent', { agentId: agent.id, message: 'Q: {{trigger.q}}' })], [edge('t', 'ag')]),
      { q: 'When are you open?' },
    );
    expect(r.status).toBe('success');
    expect(step(r, 'ag')?.output).toMatchObject({ reply: 'Our hours are 9 to 5.', status: 'replied' });
    const other = (await makeUser('agentnode')).id;
    const { run: r2 } = await run(other, manual([node('ag', 'ai.agent', { agentId: agent.id, message: 'x' })], [edge('t', 'ag')]));
    expect(step(r2, 'ag')?.error).toBe('agent_not_found');
  });

  it('Código: deshabilitado sin sandbox; con runner devuelve el resultado', async () => {
    const ws = (await makeUser('code')).id;
    const graph = manual([node('code', 'data.code', { code: 'return { double: input.trigger.n * 2 };', timeoutSec: 99 })], [edge('t', 'code')]);
    vi.stubEnv('FLOW_CODE_RUNNER', 'none');
    const { run: off } = await run(ws, graph, { n: 21 });
    expect(step(off, 'code')?.error).toBe('code_unavailable');
    let job: { timeoutMs: number; input: unknown } | null = null;
    setFlowCodeRunnerForTests(async (j) => {
      job = j;
      const input = j.input as { trigger: { n: number } };
      return { ok: true, result: { double: input.trigger.n * 2 }, logs: '' };
    });
    const { run: on } = await run(ws, graph, { n: 21 });
    expect(step(on, 'code')?.output).toEqual({ result: { double: 42 } });
    expect(job!.timeoutMs).toBe(30_000); // tope de 30 s
  });

  it('Merge espera a las dos ramas; Aggregate resume listas', async () => {
    const ws = (await makeUser('merge')).id;
    const graph = manual(
      [
        node('a', 'data.set', { fields: [{ key: 'x', value: '1' }] }),
        node('b', 'data.set', { fields: [{ key: 'y', value: '2' }] }),
        node('m', 'data.merge', {
          mode: 'merge',
          fields: [
            { key: '...', value: '{{nodes.a.output}}' },
            { key: 'y', value: '{{nodes.b.output.y}}' },
          ],
        }),
        node('sum', 'data.merge', { mode: 'aggregate', items: '{{trigger.deals}}', field: 'amount', operation: 'sum' }),
        node('names', 'data.merge', { mode: 'aggregate', items: '{{trigger.deals}}', field: 'name', operation: 'unique' }),
      ],
      [edge('t', 'a'), edge('t', 'b'), edge('a', 'm'), edge('b', 'm'), edge('m', 'sum'), edge('sum', 'names')],
    );
    const { run: r } = await run(ws, graph, {
      deals: [
        { name: 'A', amount: 10 },
        { name: 'B', amount: '5.5' },
        { name: 'A', amount: 1 },
      ],
    });
    expect(r.status).toBe('success');
    expect(r.steps.filter((s) => s.nodeId === 'm')).toHaveLength(1);
    expect(step(r, 'm')?.output).toEqual({ x: '1', y: '2' });
    expect(step(r, 'sum')?.output).toMatchObject({ operation: 'sum', value: 16.5, count: 3 });
    expect(step(r, 'names')?.output).toMatchObject({ value: ['A', 'B'] });
  });

  it('Ejecutar flow: corre un sub-flow con entradas y corta la recursión', async () => {
    const ws = (await makeUser('sub')).id;
    const child = await newFlow(ws, manual([node('greet', 'data.set', { fields: [{ key: 'msg', value: 'Hi {{trigger.name}}' }] })], [edge('t', 'greet')]), 'Child');
    const parent = await newFlow(
      ws,
      manual(
        [
          node('call', 'logic.run_flow', { flowId: child.id, inputs: [{ key: 'name', value: '{{trigger.who}}' }] }),
          node('use', 'data.set', { fields: [{ key: 'got', value: '{{nodes.call.output.outputs.greet.msg}}' }] }),
        ],
        [edge('t', 'call'), edge('call', 'use')],
      ),
      'Parent',
    );
    const res = await runFlowNow(ws, parent.id, { who: 'Ada' });
    const r = res.ok ? res.run : null;
    expect(r?.status).toBe('success');
    expect(step(r, 'use')?.output).toEqual({ got: 'Hi Ada' });
    const sub = (await getDb().prepare('SELECT trigger_type, parent_run_id, chain_depth FROM flow_runs WHERE flow_id = ?').get(child.id)) as {
      trigger_type: string;
      parent_run_id: string;
      chain_depth: number;
    };
    expect(sub).toMatchObject({ trigger_type: 'subflow', parent_run_id: r!.id, chain_depth: 1 });

    // Un flow que se llama a sí mismo: error claro.
    const self = await newFlow(ws, manual([], []));
    await updateFlow(ws, self.id, { graph: manual([node('call', 'logic.run_flow', { flowId: self.id })], [edge('t', 'call')]) });
    const loop = await runFlowNow(ws, self.id, {});
    expect(step(loop.ok ? loop.run! : null, 'call')?.error).toBe('subflow_recursion');
  });
});

// ---------- Versiones y plantillas ----------

describe('Flow: versiones y plantillas', () => {
  it('guarda un snapshot por cambio, muestra el diff y restaura', async () => {
    const ws = (await makeUser('ver')).id;
    const g1 = manual([node('a', 'data.set')], [edge('t', 'a')]);
    const flow = await newFlow(ws, g1);
    const g2 = manual([node('a', 'data.set', { fields: [{ key: 'x', value: '1' }] }), node('b', 'data.set')], [edge('t', 'a'), edge('a', 'b')]);
    expect((await updateFlow(ws, flow.id, { graph: g2 })).ok).toBe(true);
    // Cambiar solo el nombre o guardar el mismo grafo no crea versión.
    await updateFlow(ws, flow.id, { name: 'Renamed' });
    await updateFlow(ws, flow.id, { graph: g2 });
    const g3 = manual([node('b', 'data.set')], [edge('t', 'b')]);
    await updateFlow(ws, flow.id, { graph: g3 });

    const versions = await listFlowVersions(ws, flow.id);
    expect(versions.map((v) => v.nodeCount)).toEqual([2, 3, 2]);
    expect(versions[0].diff).toMatchObject({ added: [], removed: ['a'] });
    expect(versions[1].diff).toMatchObject({ added: ['b'], removed: [], changed: ['a'] });
    expect(await listFlowVersions((await makeUser('ver')).id, flow.id)).toEqual([]);

    const res = await restoreFlowVersion(ws, flow.id, versions[1].id, ws);
    expect(res.ok && res.flow.graph.nodes.map((n) => n.id)).toEqual(['t', 'a', 'b']);
    expect((await getFlow(ws, flow.id))?.graph.nodes.find((n) => n.id === 'a')?.config).toEqual({ fields: [{ key: 'x', value: '1' }] });
    expect(await listFlowVersions(ws, flow.id)).toHaveLength(4);
    expect(diffGraphs(null, g1)).toMatchObject({ added: ['t', 'a'], edgesAdded: 1 });
  });

  it('cada nodo, campo, opción y plantilla tiene textos en es/en/pt', async () => {
    const { NODE_DEFS } = await import('@/lib/flow-schema');
    const { CREDENTIAL_TYPE_KEYS, credentialFields } = await import('@/lib/flow-credentials-schema');
    for (const l of ['es', 'en', 'pt']) {
      const m = (await import(`@/messages/${l}/flow.json`)).default as Record<string, Record<string, Record<string, unknown>>>;
      const miss: string[] = [];
      const nodes = m.nodes as Record<string, { title?: string; fields?: Record<string, string> }>;
      for (const [type, def] of Object.entries(NODE_DEFS)) {
        const k = type.replace(/\./g, '_');
        if (!nodes[k]?.title) miss.push(`nodes.${k}`);
        for (const f of def.fields as ReadonlyArray<{ key: string; kind: string; options?: readonly string[] }>) {
          if (!m.fields[f.key] && !nodes[k]?.fields?.[f.key]) miss.push(`fields.${f.key}`);
          if (f.kind === 'bool' && !m.fields[`${f.key}Hint`] && !nodes[k]?.fields?.[`${f.key}Hint`]) miss.push(`fields.${f.key}Hint`);
          if (f.kind === 'select' && !['method', 'filterOp', 'parseMode'].includes(f.key)) {
            for (const o of f.options ?? []) if (!m.options[o]) miss.push(`options.${o}`);
          }
        }
      }
      for (const t of FLOW_TEMPLATES) if (!(m.templates.items as Record<string, unknown>)[t.key]) miss.push(`templates.${t.key}`);
      const creds = m.credentials as Record<string, Record<string, string>>;
      for (const type of CREDENTIAL_TYPE_KEYS) {
        if (!creds.types[type] || !creds.typeHints[type]) miss.push(`credentials.types.${type}`);
        for (const f of credentialFields(type)) if (!creds.fields[f.key]) miss.push(`credentials.fields.${f.key}`);
      }
      expect(miss, l).toEqual([]);
    }
  });

  it('las plantillas son válidas y solo usan nodos que existen', () => {
    expect(FLOW_TEMPLATES.length).toBeGreaterThanOrEqual(15);
    const keys = new Set<string>();
    for (const t of FLOW_TEMPLATES) {
      expect(validateGraph(t.graph), t.key).toMatchObject({ ok: true });
      expect(keys.has(t.key)).toBe(false);
      keys.add(t.key);
    }
  });
});
