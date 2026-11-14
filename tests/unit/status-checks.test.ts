import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkWeb, checkWhatsapp } from '@/lib/status/checks';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function stubFetch(handler: Handler) {
  vi.stubGlobal('fetch', vi.fn((input: string | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init))));
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GROUPS_BRIDGE_URL;
  delete process.env.GROUPS_BRIDGE_KEY;
  delete process.env.STATUS_SITE_URL;
});

describe('status: chequeo de Evolution', () => {
  it('sin GROUPS_BRIDGE_URL/KEY no se chequea', async () => {
    expect(await checkWhatsapp()).toBeNull();
  });

  it('instancias conectadas y la base responde: up, con el conteo como detalle interno', async () => {
    process.env.GROUPS_BRIDGE_URL = 'https://evo.test';
    process.env.GROUPS_BRIDGE_KEY = 'bridge-key-abcdef';
    const calls: string[] = [];
    stubFetch((url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      expect((init?.headers as Record<string, string>).apikey).toBe('bridge-key-abcdef');
      if (url.endsWith('/instance/fetchInstances')) return json([{ name: 'ws-a', connectionStatus: 'open' }, { name: 'ws-b', connectionStatus: 'close' }]);
      return json({ messages: { total: 1, records: [{}] } });
    });
    const r = await checkWhatsapp();
    expect(r).toMatchObject({ status: 'up', detail: '1/2 instances open' });
    expect(calls).toEqual(['GET https://evo.test/instance/fetchInstances', 'POST https://evo.test/chat/findMessages/ws-a']);
  });

  it('Postgres caído: fetchInstances contesta pero findMessages no → down, sin la key en el error', async () => {
    process.env.GROUPS_BRIDGE_URL = 'https://evo.test';
    process.env.GROUPS_BRIDGE_KEY = 'bridge-key-abcdef';
    stubFetch((url) => {
      if (url.endsWith('/instance/fetchInstances')) return json([{ name: 'ws-a', connectionStatus: 'open' }]);
      return new Response("PrismaClientInitializationError: Can't reach database server (apikey=bridge-key-abcdef)", { status: 500 });
    });
    const r = await checkWhatsapp();
    expect(r?.status).toBe('down');
    expect(r?.error).toMatch(/findMessages \(database\) HTTP 500.*reach database/);
    expect(r?.error).not.toContain('bridge-key-abcdef');
  });

  it('ninguna línea conectada: degraded; la API caída: down', async () => {
    process.env.GROUPS_BRIDGE_URL = 'https://evo.test';
    process.env.GROUPS_BRIDGE_KEY = 'bridge-key-abcdef';
    stubFetch((url) => (url.endsWith('/instance/fetchInstances') ? json([{ name: 'a', connectionStatus: 'close' }]) : json({ messages: { records: [] } })));
    expect((await checkWhatsapp())?.status).toBe('degraded');
    stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    expect((await checkWhatsapp())?.status).toBe('down');
  });
});

describe('status: chequeo del sitio', () => {
  it('home y /api/version bien: up; un 502: down; un 403 del firewall: no es caída', async () => {
    process.env.STATUS_SITE_URL = 'https://site.test';
    stubFetch((url) => (url.endsWith('/api/version') ? json({ build: 'abc123' }) : new Response('<html>', { status: 200 })));
    expect((await checkWeb()).status).toBe('up');
    stubFetch((url) => (url.endsWith('/api/version') ? json({ build: 'abc123' }) : new Response('bad gateway', { status: 502 })));
    expect(await checkWeb()).toMatchObject({ status: 'down', error: 'home returned HTTP 502' });
    stubFetch((url) => (url.endsWith('/api/version') ? json({ build: 'abc123' }) : new Response('forbidden', { status: 403 })));
    expect((await checkWeb()).status).toBe('up');
    stubFetch((url) => (url.endsWith('/api/version') ? json({}) : new Response('<html>', { status: 200 })));
    expect((await checkWeb()).status).toBe('degraded');
  });
});
