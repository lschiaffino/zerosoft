import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import {
  availableProviders,
  connectNumber,
  createGroups,
  createLabel,
  createNumber,
  deleteNumber,
  disconnectNumber,
  getNumberRowById,
  listChats,
  listLabels,
  listMembers,
  listMessages,
  listNumbers,
  providerFor,
  readConfig,
  sendMessage,
  updateMembers,
} from '@/lib/groups';
import { managedProvider, validManagedConfig } from '@/lib/groups-provider-managed';
import { ProviderError, type FetchLike } from '@/lib/groups-provider';
import { clearSampleData, loadSampleData } from '@/lib/groups-sample';
import { listTickets } from '@/lib/groups-tickets';
import { makeUser } from './helpers';

const webhookRoute = await import('@/app/api/groups/webhook/[id]/[secret]/route');

const BRIDGE = 'https://bridge.example.test';
const GLOBAL_KEY = 'global-key-never-leaves-the-server';

interface Call {
  url: string;
  method: string;
  apikey: string | null;
  body: unknown;
}

/** Evolution simulado: guarda cada pedido y contesta como v2. */
function evolutionMock(opts: { state?: string; status?: number } = {}) {
  const calls: Call[] = [];
  const handler = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init.method ?? 'GET', apikey: new Headers(init.headers).get('apikey'), body });
    if (opts.status) return new Response(JSON.stringify({ error: `bad key ${GLOBAL_KEY}` }), { status: opts.status });
    const path = new URL(url).pathname;
    let out: unknown = {};
    if (path.startsWith('/instance/create')) out = { instance: { instanceName: body?.instanceName, status: 'created' }, hash: body?.token };
    else if (path.startsWith('/instance/connectionState')) out = { instance: { state: opts.state ?? 'connecting' } };
    else if (path.startsWith('/instance/connect/')) out = { base64: 'data:image/png;base64,QRDATA' };
    else if (path.startsWith('/instance/fetchInstances')) out = [{ ownerJid: '5491100009999@s.whatsapp.net' }];
    else if (path.startsWith('/message/sendText')) out = { key: { id: 'MSG-1' } };
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const f: FetchLike = (url, init) => handler(url, init);
  return { calls, handler, f };
}

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
  vi.stubEnv('GROUPS_BRIDGE_URL', BRIDGE);
  vi.stubEnv('GROUPS_BRIDGE_KEY', GLOBAL_KEY);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('QR administrado: disponibilidad y alta', () => {
  it('sin las variables del servidor no se ofrece ni se puede crear', async () => {
    vi.stubEnv('GROUPS_BRIDGE_URL', '');
    expect(availableProviders()).not.toContain('managed');
    const user = await makeUser('managed-off');
    await expect(createNumber(user.id, user.id, { provider: 'managed' })).rejects.toMatchObject({ code: 'invalid_provider' });
  });

  it('con las variables es la primera opción; el de ejemplo nunca se agrega a mano', () => {
    expect(availableProviders()[0]).toBe('managed');
    expect(availableProviders()).not.toContain('sample');
  });

  it('el alta genera nombre y token propios; ni el token ni la clave global salen en el DTO ni en la fila', async () => {
    const user = await makeUser('managed-new');
    const n = await createNumber(user.id, user.id, { provider: 'managed', config: { session: 'otra-instancia', apiKey: GLOBAL_KEY, baseUrl: 'https://evil.test' } });
    const row = (await getNumberRowById(n.id))!;
    const cfg = readConfig(row);
    expect(validManagedConfig(cfg)).toBe(true);
    expect(cfg.session).not.toBe('otra-instancia');
    expect(cfg.baseUrl).toBeUndefined();
    expect(cfg.apiKey).toBeUndefined();
    expect(row.config).not.toContain(GLOBAL_KEY);
    const dto = JSON.stringify(await listNumbers(user.id));
    expect(dto).not.toContain(String(cfg.instanceToken));
    expect(dto).not.toContain(String(cfg.session));
    expect(dto).not.toContain(GLOBAL_KEY);
    expect(dto).not.toContain(BRIDGE);
  });
});

describe('QR administrado: llamadas a Evolution', () => {
  it('crea la instancia con la clave global y todo lo demás va con el token de la instancia', async () => {
    const mock = evolutionMock();
    vi.stubGlobal('fetch', mock.handler);
    const user = await makeUser('managed-connect');
    const n = await createNumber(user.id, user.id, { provider: 'managed' });
    const cfg = readConfig((await getNumberRowById(n.id))!);
    const state = await connectNumber(user.id, n.id, 'http://localhost:3000');
    expect(state).toMatchObject({ status: 'qr', qr: 'data:image/png;base64,QRDATA' });
    const create = mock.calls.find((c) => c.url.endsWith('/instance/create'))!;
    expect(create.apikey).toBe(GLOBAL_KEY);
    expect(create.body).toMatchObject({ instanceName: cfg.session, token: cfg.instanceToken, integration: 'WHATSAPP-BAILEYS', qrcode: true });
    expect((create.body as { webhook: { url: string } }).webhook.url).toMatch(new RegExp(`/api/groups/webhook/${n.id}/[a-f0-9]{48}$`));
    const rest = mock.calls.filter((c) => c !== create);
    expect(rest.length).toBeGreaterThan(0);
    for (const c of rest) {
      expect(c.apikey).toBe(cfg.instanceToken);
      expect(c.url.startsWith(BRIDGE)).toBe(true);
    }
    expect(rest.some((c) => c.url === `${BRIDGE}/webhook/set/${cfg.session}`)).toBe(true);
  });

  it('desconectar cierra la sesión y borra la instancia; borrar el número también', async () => {
    const mock = evolutionMock({ state: 'open' });
    vi.stubGlobal('fetch', mock.handler);
    const user = await makeUser('managed-delete');
    const n = await createNumber(user.id, user.id, { provider: 'managed' });
    const cfg = readConfig((await getNumberRowById(n.id))!);
    await disconnectNumber(user.id, n.id);
    expect(mock.calls.map((c) => `${c.method} ${c.url.replace(BRIDGE, '')} ${c.apikey === GLOBAL_KEY ? 'global' : 'instance'}`)).toEqual([
      `DELETE /instance/logout/${cfg.session} instance`,
      `DELETE /instance/delete/${cfg.session} global`,
    ]);
    mock.calls.length = 0;
    expect(await deleteNumber(user.id, n.id)).toBe(true);
    expect(mock.calls.some((c) => c.method === 'DELETE' && c.url === `${BRIDGE}/instance/delete/${cfg.session}`)).toBe(true);
    expect(await getNumberRowById(n.id)).toBeNull();
  });

  it('los errores del servidor salen como código corto, sin la clave', async () => {
    const mock = evolutionMock({ status: 401 });
    vi.stubGlobal('fetch', mock.handler);
    const user = await makeUser('managed-err');
    const n = await createNumber(user.id, user.id, { provider: 'managed' });
    const err = await connectNumber(user.id, n.id).catch((e: Error) => e);
    expect(err).toMatchObject({ code: 'auth_failed' });
    expect(String((err as Error).message)).not.toContain(GLOBAL_KEY);
    const row = (await getNumberRowById(n.id))!;
    expect(row.last_error).toBe('auth_failed');
  });
});

describe('QR administrado: aislamiento entre workspaces', () => {
  it('cada número habla solo con su instancia y otro workspace no lo puede tocar', async () => {
    const mock = evolutionMock({ state: 'open' });
    vi.stubGlobal('fetch', mock.handler);
    const a = await makeUser('managed-a');
    const b = await makeUser('managed-b');
    const na = await createNumber(a.id, a.id, { provider: 'managed' });
    const nb = await createNumber(b.id, b.id, { provider: 'managed' });
    const ca = readConfig((await getNumberRowById(na.id))!);
    const cb = readConfig((await getNumberRowById(nb.id))!);
    expect(ca.session).not.toBe(cb.session);
    expect(ca.instanceToken).not.toBe(cb.instanceToken);

    // B no puede conectar, desconectar ni borrar el número de A.
    await expect(connectNumber(b.id, na.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(disconnectNumber(b.id, na.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(await deleteNumber(b.id, na.id)).toBe(false);
    expect(mock.calls).toHaveLength(0);

    // Lo que hace B solo menciona su instancia y su token.
    await connectNumber(b.id, nb.id);
    for (const c of mock.calls) {
      expect(c.url).not.toContain(String(ca.session));
      expect(c.apikey).not.toBe(ca.instanceToken);
    }
  });

  it('una fila alterada (instancia o token que no generamos) no llega al servidor', () => {
    const mock = evolutionMock();
    const env = { baseUrl: BRIDGE, globalKey: GLOBAL_KEY };
    expect(() => managedProvider({ session: 'zs-otra/../../instance', instanceToken: 'a'.repeat(48) }, { env, fetch: mock.f })).toThrow(ProviderError);
    expect(() => managedProvider({ session: 'zs-0123456789abcdef0123', instanceToken: GLOBAL_KEY }, { env, fetch: mock.f })).toThrow(ProviderError);
    expect(() => managedProvider({ session: 'zs-0123456789abcdef0123', instanceToken: 'a'.repeat(48) }, { env: null, fetch: mock.f })).toThrow(ProviderError);
    expect(mock.calls).toHaveLength(0);
  });

  it('el webhook solo acepta eventos de la instancia del número', async () => {
    const user = await makeUser('managed-hook');
    const n = await createNumber(user.id, user.id, { provider: 'managed' });
    const row = (await getNumberRowById(n.id))!;
    const cfg = readConfig(row);
    const event = (instance: string) =>
      JSON.stringify({
        event: 'messages.upsert',
        instance,
        data: { key: { remoteJid: '5491155550000@s.whatsapp.net', fromMe: false, id: `IN-${instance.slice(-4)}` }, pushName: 'Ana', message: { conversation: 'hola' } },
      });
    const post = (body: string) =>
      webhookRoute.POST(new Request(`http://localhost/api/groups/webhook/${row.id}/${row.webhook_secret}`, { method: 'POST', body }), {
        params: Promise.resolve({ id: row.id, secret: row.webhook_secret }),
      });
    expect((await post(event('zs-ffffffffffffffffffff'))).status).toBe(401);
    const ok = await post(event(String(cfg.session)));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ messages: 1 });
    expect(providerFor(row).kind).toBe('managed');
  });
});

describe('datos de ejemplo', () => {
  it('cargan chats, grupos, ticket y envío programado; responder no sale a la red; borrar no toca lo real', async () => {
    const net = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', net);
    const user = await makeUser('sample');
    const mine = await createLabel(user.id, { name: 'Mía', color: 'red' });
    // Una etiqueta real con el mismo nombre que una del ejemplo: se reusa y no se borra.
    await createLabel(user.id, { name: 'Ventas', color: 'gray' });

    const number = await loadSampleData(user.id, user.id, 'es');
    expect(number.provider).toBe('sample');
    expect(number.status).toBe('connected');
    // Cargar dos veces no duplica.
    expect((await loadSampleData(user.id, user.id, 'es')).id).toBe(number.id);
    const all = await listChats(user.id, user.id, { limit: 100 });
    const closed = await listChats(user.id, user.id, { filter: 'closed', limit: 100 });
    expect(all.total + closed.total).toBe(12);
    expect(all.rows.some((c) => c.kind === 'group')).toBe(true);
    expect((await listChats(user.id, user.id, { filter: 'unanswered' })).rows.length).toBeGreaterThanOrEqual(1);
    expect((await listTickets(user.id)).length).toBe(1);
    const broadcasts = (await getDb().prepare("SELECT kind, status FROM groups_broadcasts WHERE user_id = ?").all(user.id)) as Array<{ kind: string; status: string }>;
    expect(broadcasts).toEqual([{ kind: 'scheduled', status: 'scheduled' }]);
    const group = all.rows.find((c) => c.kind === 'group')!;
    const msgs = await listMessages(user.id, group.id);
    expect(msgs.some((m) => m.direction === 'note')).toBe(true);

    // Responder, crear un grupo y sumar miembros: todo queda como hecho, sin red.
    const lucia = all.rows.find((c) => c.name === 'Lucía Fernández')!;
    const sent = await sendMessage(user.id, user.id, lucia.id, { body: 'Hola Lucía, ya lo revisamos.' });
    expect(sent.status).toBe('sent');
    const created = await createGroups(user.id, number.id, [{ name: 'Grupo nuevo', phones: ['+54 9 11 5555 0001'] }]);
    expect(created[0]).toMatchObject({ ok: true, notAdded: [] });
    const res = await updateMembers(user.id, [created[0].chatId!], 'add', ['+54 9 11 5555 0002']);
    expect(res[0].results[0].ok).toBe(true);
    expect((await listMembers(user.id, created[0].chatId!)).length).toBe(3);
    expect(net).not.toHaveBeenCalled();

    // Algo real al lado: un número falso con su chat no se toca.
    vi.stubEnv('GROUPS_FAKE', '1');
    vi.stubEnv('NODE_ENV', 'test');
    const real = await createNumber(user.id, user.id, { provider: 'fake', name: 'Real' });

    expect(await clearSampleData(user.id)).toBe(true);
    expect((await listNumbers(user.id)).map((n) => n.id)).toEqual([real.id]);
    expect((await listChats(user.id, user.id, { limit: 100 })).total).toBe(0);
    expect(await listTickets(user.id)).toHaveLength(0);
    const labels = (await listLabels(user.id)).map((l) => l.name).sort();
    expect(labels).toEqual(['Mía', 'Ventas']);
    expect(labels).not.toContain('Soporte');
    expect(mine.id).toBeTruthy();
    const left = (await getDb().prepare('SELECT COUNT(*) AS c FROM groups_messages WHERE number_id = ?').get(number.id)) as { c: number };
    expect(Number(left.c)).toBe(0);
    expect(await clearSampleData(user.id)).toBe(false);
  });

  it('los textos siguen el idioma', async () => {
    const user = await makeUser('sample-en');
    await loadSampleData(user.id, user.id, 'en');
    const names = (await listChats(user.id, user.id, { limit: 100 })).rows.map((c) => c.name);
    expect(names).toContain('Acme · Rollout');
    expect((await listNumbers(user.id))[0].name).toBe('Sample number');
  });
});
