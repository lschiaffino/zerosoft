import { describe, expect, it } from 'vitest';
import {
  HubspotApiError,
  HubspotBudget,
  bindHubspotTokenPortal,
  createHubspotClient,
  hubspotTokenFingerprint,
  newHubspotBudgetRegistry,
  safeHubspotPath,
} from '@/lib/hubspot/client';
import { FakeHubspotPortal, seedSyncPortal } from '@/lib/hubspot/fake-portal';

/**
 * El cliente compartido de HubSpot (lib/hubspot/client.ts): el presupuesto de
 * pedidos (por clave la ráfaga, por cuenta el día), los reintentos con
 * Retry-After y que un error nunca lleve el token ni datos de un registro.
 * Todo contra la cuenta falsa; nada sale a internet.
 */

const TOKEN = 'pat-na1-client-test';
const OTHER = 'pat-na1-client-test-other';

function clock(start = 1_000_000) {
  const c = { t: start, slept: [] as number[] };
  return {
    c,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.slept.push(ms);
      c.t += ms;
    },
  };
}

const response = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

describe('presupuesto de pedidos', () => {
  it('dos usos de la misma clave comparten la ráfaga: el segundo espera a que se libere la ventana', async () => {
    const registry = newHubspotBudgetRegistry();
    const k = clock();
    const importer = new HubspotBudget({ token: TOKEN, registry, now: k.now, sleep: k.sleep, burstReserve: 0 });
    const lines = new HubspotBudget({ token: TOKEN, registry, now: k.now, sleep: k.sleep, burstReserve: 0 });
    for (let i = 0; i < 60; i++) await importer.take('/crm/v3/objects/contacts');
    for (let i = 0; i < 40; i++) await lines.take('/crm/v3/objects/companies');
    expect(k.c.slept).toEqual([]);
    expect(lines.snapshot().inWindow).toBe(100);
    // El pedido 101, venga de donde venga, espera los 10 s de la ventana.
    await lines.take('/crm/v3/objects/companies');
    expect(k.c.slept).toEqual([10_000]);
  });

  it('otra clave tiene su propia ráfaga', async () => {
    const registry = newHubspotBudgetRegistry();
    const k = clock();
    const a = new HubspotBudget({ token: TOKEN, registry, now: k.now, sleep: k.sleep, burstReserve: 0 });
    const b = new HubspotBudget({ token: OTHER, registry, now: k.now, sleep: k.sleep, burstReserve: 0 });
    for (let i = 0; i < 100; i++) await a.take('/x');
    await b.take('/x');
    expect(k.c.slept).toEqual([]);
  });

  it('deja una reserva de la ráfaga por defecto (90 de 100)', async () => {
    const k = clock();
    const b = new HubspotBudget({ token: TOKEN, registry: newHubspotBudgetRegistry(), now: k.now, sleep: k.sleep });
    for (let i = 0; i < 90; i++) await b.take('/x');
    expect(k.c.slept).toEqual([]);
    await b.take('/x');
    expect(k.c.slept).toEqual([10_000]);
  });

  it('lee el tope y la ventana de los headers de HubSpot, y frena cuando queda poco en la ventana real', async () => {
    const k = clock();
    const b = new HubspotBudget({ token: TOKEN, registry: newHubspotBudgetRegistry(), now: k.now, sleep: k.sleep });
    b.observe(new Headers({ 'x-hubspot-ratelimit-max': '190', 'x-hubspot-ratelimit-interval-milliseconds': '10000', 'x-hubspot-ratelimit-remaining': '150' }));
    expect(b.snapshot()).toMatchObject({ max: 190, windowMs: 10_000 });
    await b.take('/x');
    expect(k.c.slept).toEqual([]);
    // Otra instancia gastó casi todo: HubSpot dice que quedan 5 de 190.
    b.observe(new Headers({ 'x-hubspot-ratelimit-max': '190', 'x-hubspot-ratelimit-interval-milliseconds': '10000', 'x-hubspot-ratelimit-remaining': '5' }));
    await b.take('/x');
    expect(k.c.slept).toEqual([2_500]);
  });

  it('el cupo diario es de la cuenta: lo comparten dos claves de la misma cuenta y corta sin llamar', async () => {
    const registry = newHubspotBudgetRegistry();
    const k = clock();
    const a = new HubspotBudget({ token: TOKEN, portalId: '515151', registry, now: k.now, sleep: k.sleep });
    const b = new HubspotBudget({ token: OTHER, portalId: '515151', registry, now: k.now, sleep: k.sleep });
    const stranger = new HubspotBudget({ token: 'pat-na1-another-portal', portalId: '999', registry, now: k.now, sleep: k.sleep });
    a.observe(new Headers({ 'x-hubspot-ratelimit-daily': '250000', 'x-hubspot-ratelimit-daily-remaining': '4000' }));
    expect(b.snapshot()).toMatchObject({ dailyLimit: 250_000, dailyRemaining: 4000, dailyBlocked: true });
    await expect(b.take('/crm/v3/objects/contacts')).rejects.toMatchObject({ code: 'rate_limited', policy: 'daily' });
    await expect(stranger.take('/crm/v3/objects/contacts')).resolves.toBeUndefined();
    // Pasado un rato se vuelve a probar (HubSpot reinicia el cupo a medianoche de la cuenta).
    k.c.t += 16 * 60_000;
    await expect(b.take('/crm/v3/objects/contacts')).resolves.toBeUndefined();
  });

  it('lo que se sabía del cupo de una clave pasa a su cuenta cuando se la conoce', () => {
    const registry = newHubspotBudgetRegistry();
    const k = clock();
    const a = new HubspotBudget({ token: TOKEN, registry, now: k.now, sleep: k.sleep });
    a.observe(new Headers({ 'x-hubspot-ratelimit-daily': '1000', 'x-hubspot-ratelimit-daily-remaining': '700' }));
    bindHubspotTokenPortal(TOKEN, '515151', registry);
    const b = new HubspotBudget({ token: OTHER, portalId: '515151', registry, now: k.now, sleep: k.sleep });
    expect(b.snapshot()).toMatchObject({ dailyLimit: 1000, dailyRemaining: 700 });
  });

  it('una acción de pantalla no espera más de su tope: corta con rate_limited', async () => {
    const k = clock();
    const b = new HubspotBudget({ token: TOKEN, registry: newHubspotBudgetRegistry(), now: k.now, sleep: k.sleep, burstReserve: 0, maxWaitMs: 3_000 });
    for (let i = 0; i < 100; i++) await b.take('/x');
    await expect(b.take('/x')).rejects.toMatchObject({ code: 'rate_limited', policy: 'burst' });
    expect(k.c.slept).toEqual([]);
  });

  it('la búsqueda tiene su propio tope por segundo', async () => {
    const k = clock();
    const b = new HubspotBudget({ token: TOKEN, registry: newHubspotBudgetRegistry(), now: k.now, sleep: k.sleep });
    for (let i = 0; i < 4; i++) await b.take('/crm/v3/objects/contacts/search');
    expect(k.c.slept).toEqual([]);
    await b.take('/crm/v3/objects/contacts/search');
    expect(k.c.slept).toEqual([1_000]);
  });

  it('el cliente lee los headers de la cuenta falsa en cada respuesta', async () => {
    const portal = seedSyncPortal();
    portal.rate = { max: 190, intervalMs: 10_000, remaining: 100, daily: 625_000, dailyRemaining: 600_000 };
    const k = clock();
    const budget = new HubspotBudget({ token: TOKEN, registry: newHubspotBudgetRegistry(), now: k.now, sleep: k.sleep });
    const client = createHubspotClient({ token: TOKEN, fetch: portal.fetch, sleep: k.sleep, budget });
    await client.request('/crm/v3/owners');
    expect(budget.snapshot()).toMatchObject({ max: 190, dailyLimit: 625_000, dailyRemaining: 599_999, inWindow: 1 });
    // La búsqueda no trae headers: no pisa lo que se sabía.
    await client.request('/crm/v3/objects/contacts/search', { method: 'POST', body: { limit: 1 } });
    expect(budget.snapshot()).toMatchObject({ max: 190, dailyRemaining: 599_999 });
  });
});

describe('reintentos', () => {
  it('ante un 429 espera lo que dice Retry-After y reintenta', async () => {
    const portal = seedSyncPortal();
    portal.fail(429, 2, { retryAfter: '3' });
    const k = clock();
    const client = createHubspotClient({ token: TOKEN, fetch: portal.fetch, sleep: k.sleep, budget: null });
    const res = await client.request<{ results: unknown[] }>('/crm/v3/owners', { retries: 3 });
    expect(res.results).toHaveLength(2);
    expect(k.c.slept).toEqual([3_000, 3_000]);
  });

  it('sin Retry-After espera 1 s, 2 s, 4 s y al agotar los reintentos corta con rate_limited', async () => {
    const portal = seedSyncPortal();
    portal.fail(429, 10);
    const k = clock();
    const client = createHubspotClient({ token: TOKEN, fetch: portal.fetch, sleep: k.sleep, budget: null });
    await expect(client.request('/crm/v3/owners', { retries: 3 })).rejects.toMatchObject({ code: 'rate_limited', status: 429, policy: 'burst' });
    expect(k.c.slept).toEqual([1_000, 2_000, 4_000]);
  });

  it('no espera más que el tope total que le dan', async () => {
    const portal = seedSyncPortal();
    portal.fail(429, 10, { retryAfter: '5' });
    const k = clock();
    const client = createHubspotClient({ token: TOKEN, fetch: portal.fetch, sleep: k.sleep, budget: null });
    await expect(client.request('/crm/v3/owners', { retries: 5, maxWaitMs: 4_000 })).rejects.toMatchObject({ code: 'rate_limited' });
    expect(k.c.slept).toEqual([]);
  });

  it('el límite diario no se reintenta y frena los demás usos de esa cuenta', async () => {
    const portal = seedSyncPortal();
    portal.fail(429, 1, { policyName: 'DAILY' });
    const registry = newHubspotBudgetRegistry();
    const k = clock();
    const budget = new HubspotBudget({ token: TOKEN, portalId: portal.portalId, registry, now: k.now, sleep: k.sleep });
    const client = createHubspotClient({ token: TOKEN, fetch: portal.fetch, sleep: k.sleep, budget });
    await expect(client.request('/crm/v3/owners', { retries: 5 })).rejects.toMatchObject({ code: 'rate_limited', policy: 'daily' });
    expect(k.c.slept).toEqual([]);
    const calls = portal.calls.length;
    const other = new HubspotBudget({ token: OTHER, portalId: portal.portalId, registry, now: k.now, sleep: k.sleep });
    await expect(createHubspotClient({ token: OTHER, fetch: portal.fetch, sleep: k.sleep, budget: other }).request('/crm/v3/owners')).rejects.toMatchObject({ policy: 'daily' });
    expect(portal.calls.length).toBe(calls);
  });

  it('un 423 espera al menos 2 s y se reintenta; agotado es `locked`', async () => {
    const portal = seedSyncPortal();
    portal.fail(423, 1);
    const k = clock();
    const client = createHubspotClient({ token: TOKEN, fetch: portal.fetch, sleep: k.sleep, budget: null });
    await client.request('/crm/v3/owners', { retries: 1 });
    expect(k.c.slept).toEqual([2_000]);
    portal.fail(423, 5);
    await expect(client.request('/crm/v3/owners', { retries: 1 })).rejects.toMatchObject({ code: 'locked', status: 423 });
  });

  it('un 5xx se reintenta solo si se pide; si no, la respuesta vuelve tal cual', async () => {
    const portal = seedSyncPortal();
    const k = clock();
    const client = createHubspotClient({ token: TOKEN, fetch: portal.fetch, sleep: k.sleep, budget: null });
    portal.fail(503, 1);
    expect((await client.send('/crm/v3/owners')).status).toBe(503);
    portal.fail(502, 2);
    expect((await client.send('/crm/v3/owners', { retries: 3, retry5xx: true })).status).toBe(200);
    expect(k.c.slept).toEqual([1_000, 2_000]);
    portal.fail(500, 1);
    await expect(client.request('/crm/v3/owners')).rejects.toMatchObject({ code: 'http', status: 500 });
  });

  it('un error de red se reintenta con espera, o corta en el acto si se pide', async () => {
    let n = 0;
    const flaky = async () => {
      if (n++ < 2) throw new Error('ECONNRESET');
      return response(200, { ok: true });
    };
    const k = clock();
    const client = createHubspotClient({ token: TOKEN, fetch: flaky, sleep: k.sleep, budget: null });
    expect(await client.request('/crm/v3/owners', { retries: 3 })).toEqual({ ok: true });
    expect(k.c.slept).toEqual([1_000, 2_000]);
    n = 0;
    await expect(client.request('/crm/v3/owners', { retries: 3, retryNetwork: false })).rejects.toMatchObject({ code: 'network' });
  });
});

describe('errores sin datos', () => {
  it('cada status tiene su código', async () => {
    const portal = seedSyncPortal();
    const good = createHubspotClient({ token: TOKEN, fetch: portal.fetch, budget: null });
    await expect(createHubspotClient({ token: 'not-a-key', fetch: portal.fetch, budget: null }).request('/crm/v3/owners')).rejects.toMatchObject({ code: 'auth', status: 401 });
    await expect(createHubspotClient({ token: 'pat-noscope-x', fetch: portal.fetch, budget: null }).request('/crm/v3/owners')).rejects.toMatchObject({ code: 'scope', status: 403 });
    await expect(good.request('/crm/v3/objects/contacts/999999')).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('el error no lleva el token, ni la query, ni el cuerpo de la respuesta, ni un email de la ruta', async () => {
    const secret = 'pat-na1-very-secret-key-0001';
    const leaky = async () => response(400, { message: 'Property values were not valid: mara@northwind-parts.example is taken', token: secret });
    const client = createHubspotClient({ token: secret, fetch: leaky, budget: null });
    const err = (await client.request(`/crm/v3/objects/contacts/${encodeURIComponent('mara@northwind-parts.example')}?idProperty=email&hapikey=${secret}`).catch((e) => e)) as HubspotApiError;
    expect(err).toBeInstanceOf(HubspotApiError);
    expect(err.code).toBe('http');
    expect(err.path).toBe('/crm/v3/objects/contacts/:redacted');
    const dump = `${err.message} ${err.stack ?? ''} ${JSON.stringify(err)} ${JSON.stringify(Object.getOwnPropertyNames(err).map((key) => (err as unknown as Record<string, unknown>)[key]))}`;
    expect(dump).not.toContain(secret);
    expect(dump).not.toContain('northwind');
    expect(dump).not.toContain('hapikey');
  });

  it('un error de red tampoco arrastra el mensaje del fetch (podría traer la URL)', async () => {
    const secret = 'pat-na1-very-secret-key-0002';
    const client = createHubspotClient({
      token: secret,
      fetch: async (url) => {
        throw new Error(`connect ECONNREFUSED ${url} Bearer ${secret}`);
      },
      budget: null,
    });
    const err = (await client.request('/crm/v3/owners?email=mara@northwind-parts.example').catch((e) => e)) as HubspotApiError;
    expect(err.code).toBe('network');
    expect(`${err.message} ${err.stack ?? ''} ${JSON.stringify(err)}`).not.toMatch(/very-secret|northwind|Bearer/);
  });

  it('la clave no viaja a otro host: una URL absoluta que no es la de HubSpot no se pide', async () => {
    const seen: string[] = [];
    const spy = async (url: string, init?: RequestInit) => {
      seen.push(`${url} ${JSON.stringify(init?.headers ?? {})}`);
      return response(200, {});
    };
    const client = createHubspotClient({ token: TOKEN, fetch: spy, budget: null });
    for (const url of ['https://evil.example/crm/v3/owners', 'http://api.hubapi.com/crm/v3/owners', 'https://api.hubapi.com.evil.example/x', 'https://api.hubapi.com@evil.example/x']) {
      await expect(client.send(url)).rejects.toMatchObject({ code: 'blocked' });
    }
    expect(seen).toEqual([]);
    await client.send('https://api.hubapi.com/crm/v3/owners');
    await client.send('/crm/v3/owners');
    expect(seen).toHaveLength(2);
  });

  it('la ruta segura tapa tokens, emails y valores largos, y deja los ids', () => {
    expect(safeHubspotPath('https://api.hubapi.com/crm/v3/objects/contacts/4001?properties=email')).toBe('/crm/v3/objects/contacts/4001');
    expect(safeHubspotPath('/oauth/v1/access-tokens/pat-na1-abc')).toBe('/oauth/v1/access-tokens/:redacted');
    expect(safeHubspotPath('/crm/v3/objects/contacts/a%40b.example')).toBe('/crm/v3/objects/contacts/:redacted');
    expect(safeHubspotPath(`/x/${'a'.repeat(41)}`)).toBe('/x/:redacted');
  });

  it('la huella de una clave no la contiene', () => {
    const fp = hubspotTokenFingerprint(TOKEN);
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
    expect(fp).not.toContain('client-test');
    expect(hubspotTokenFingerprint(OTHER)).not.toBe(fp);
  });

  it('la cuenta falsa no guarda el token en su registro de llamadas', async () => {
    const portal = new FakeHubspotPortal();
    const client = createHubspotClient({ token: TOKEN, fetch: portal.fetch, budget: null });
    await client.request('/oauth/v2/private-apps/get/access-token-info', { method: 'POST', body: { tokenKey: TOKEN }, auth: false });
    await client.request('/account-info/v3/details');
    expect(JSON.stringify(portal.calls)).not.toContain(TOKEN);
  });
});
