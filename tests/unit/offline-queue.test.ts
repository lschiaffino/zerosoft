import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';
import {
  NEVER_OPT_IN,
  NEVER_QUEUE,
  OPT_IN_PREFIXES,
  QUEUED_HEADER,
  clearOfflineData,
  isOfflineCacheName,
  isQueuedResponse,
  replayQueue,
  shouldQueue,
  type QueuedRequest,
  type QueueStore,
} from '@/lib/offline-queue';

type SwApi = {
  shouldQueue: typeof shouldQueue;
  replayQueue: typeof replayQueue;
  NEVER_QUEUE: string[];
};

/** Carga public/sw.js en un sandbox con un `self` mínimo y devuelve lo que expone. */
function loadServiceWorker(): { api: SwApi; events: string[] } {
  const code = readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
  const events: string[] = [];
  const self: Record<string, unknown> = {
    addEventListener: (name: string) => events.push(name),
    location: { origin: 'https://app.test' },
  };
  vm.runInNewContext(code, { self, URL, Response, console });
  return { api: self.__zsOffline as SwApi, events };
}

function memoryStore(items: Array<Omit<QueuedRequest, 'id'>>): QueueStore & { left: () => QueuedRequest[] } {
  let rows = items.map((it, i) => ({ ...it, id: i + 1 }));
  return {
    all: async () => [...rows],
    remove: async (id) => {
      rows = rows.filter((r) => r.id !== id);
    },
    left: () => rows,
  };
}

/** La persona de la sesión en los tests. */
const ME = 'yo:ws1';
type Replay = typeof replayQueue;
/** replayQueue con la sesión de ME salvo que el test pase otra. */
const withMe =
  (f: Replay) =>
  (store: Parameters<Replay>[0], doFetch: Parameters<Replay>[1], owner: string | null = ME) =>
    f(store, doFetch, owner);

const item = (url: string, createdAt: number): Omit<QueuedRequest, 'id'> => ({
  owner: ME,
  url,
  method: 'POST',
  contentType: 'application/json',
  workspace: 'ws1',
  body: '{}',
  createdAt,
});

describe('shouldQueue', () => {
  it('encola cambios JSON a la API del CRM', () => {
    expect(shouldQueue('/api/crm/activities', 'POST', 'application/json')).toBe(true);
    expect(shouldQueue('/api/crm/contacts/abc', 'PATCH', 'application/json; charset=utf-8')).toBe(true);
    expect(shouldQueue('/api/crm/activities/abc', 'DELETE', null)).toBe(true);
    expect(shouldQueue('/api/crm/deals/abc/move', 'post', 'application/json')).toBe(true);
  });

  it('no encola lecturas, otras apps, archivos ni envíos de email', () => {
    expect(shouldQueue('/api/crm/contacts', 'GET', null)).toBe(false);
    expect(shouldQueue('/api/track/issues', 'POST', 'application/json')).toBe(false);
    expect(shouldQueue('/api/crm/emails', 'POST', 'application/json')).toBe(false);
    expect(shouldQueue('/api/crm/emails/draft', 'POST', 'application/json')).toBe(false);
    expect(shouldQueue('/api/crm/import/jobs', 'POST', 'application/json')).toBe(false);
    expect(shouldQueue('/api/crm/files', 'POST', 'multipart/form-data; boundary=x')).toBe(false);
    expect(shouldQueue('/api/crm/contacts/abc/ai-summary', 'POST', 'application/json')).toBe(false);
    expect(shouldQueue('/api/crm/notes', 'POST', 'text/plain')).toBe(false);
  });

  it('Track se encola solo si la página lo pide (x-zs-offline), y nunca archivos, IA ni integraciones', () => {
    expect(shouldQueue('/api/track/issues/abc', 'PATCH', 'application/json')).toBe(false);
    expect(shouldQueue('/api/track/issues/abc', 'PATCH', 'application/json', true)).toBe(true);
    expect(shouldQueue('/api/track/projects/p/issues', 'POST', 'application/json', true)).toBe(true);
    expect(shouldQueue('/api/track/issues/abc/comments', 'POST', 'application/json', true)).toBe(true);
    expect(shouldQueue('/api/track/issues/abc/attachments', 'POST', 'application/json', true)).toBe(false);
    expect(shouldQueue('/api/track/issues/abc/agent', 'POST', 'application/json', true)).toBe(false);
    expect(shouldQueue('/api/track/issues/abc/ai/summary', 'POST', 'application/json', true)).toBe(false);
    expect(shouldQueue('/api/track/github/rules', 'POST', 'application/json', true)).toBe(false);
    expect(shouldQueue('/api/track/issues/abc', 'GET', null, true)).toBe(false);
    // Otra app que todavía no lo soporta: no, aunque lo pida.
    expect(shouldQueue('/api/docs/pages/abc', 'PATCH', 'application/json', true)).toBe(false);
  });
});

describe('replayQueue', () => {
  it('reenvía en orden de creación y vacía la cola', async () => {
    const store = memoryStore([item('/b', 2), item('/a', 1), item('/c', 3)]);
    const seen: string[] = [];
    const res = await withMe(replayQueue)(store, async (r) => {
      seen.push(r.url);
      return { ok: true, status: 200 };
    });
    expect(seen).toEqual(['/a', '/b', '/c']);
    expect(res).toEqual({ done: 3, failed: 0, conflicts: 0, remaining: 0 });
    expect(store.left()).toEqual([]);
  });

  it('se corta si vuelve a caer la red y deja el resto para después', async () => {
    const store = memoryStore([item('/a', 1), item('/b', 2), item('/c', 3)]);
    let calls = 0;
    const res = await withMe(replayQueue)(store, async () => {
      calls += 1;
      if (calls === 2) throw new TypeError('Failed to fetch');
      return { ok: true, status: 201 };
    });
    expect(res).toEqual({ done: 1, failed: 0, conflicts: 0, remaining: 2 });
    expect(store.left().map((r) => r.url)).toEqual(['/b', '/c']);
  });

  it('una respuesta de error del servidor saca el item y se cuenta como fallido', async () => {
    const store = memoryStore([item('/a', 1), item('/b', 2)]);
    const res = await withMe(replayQueue)(store, async (r) => (r.url === '/a' ? { ok: false, status: 404 } : { ok: true, status: 200 }));
    expect(res).toEqual({ done: 1, failed: 1, conflicts: 0, remaining: 0 });
    expect(store.left()).toEqual([]);
  });
});

describe('replayQueue con otro workspace activo', () => {
  it('un 401 deja el item y lo que sigue de ese workspace; lo de otro workspace sigue', async () => {
    const store = memoryStore([
      { ...item('/a', 1), workspace: 'ws1' },
      { ...item('/b', 2), workspace: 'ws1' },
      { ...item('/c', 3), workspace: 'ws2' },
    ]);
    const seen: string[] = [];
    const res = await withMe(replayQueue)(store, async (r) => {
      seen.push(r.url);
      return r.workspace === 'ws1' ? { ok: false, status: 401 } : { ok: true, status: 200 };
    });
    expect(seen).toEqual(['/a', '/c']);
    expect(res).toEqual({ done: 1, failed: 0, conflicts: 0, remaining: 2, blocked: true });
    expect(store.left().map((i) => i.url)).toEqual(['/a', '/b']);
  });
});

describe('replayQueue con items viejos', () => {
  it('sin workspace no se envía: queda retenido y se cuenta aparte', async () => {
    const store = memoryStore([{ ...item('/old', 1), workspace: undefined }, item('/new', 2)]);
    const seen: string[] = [];
    const res = await withMe(replayQueue)(store, async (r) => {
      seen.push(r.url);
      return { ok: true, status: 200 };
    });
    expect(seen).toEqual(['/new']);
    expect(res).toEqual({ done: 1, failed: 0, conflicts: 0, remaining: 1, blocked: true, unknown: 1 });
    expect(store.left().map((i) => i.url)).toEqual(['/old']);
  });
});

describe('replayQueue: errores, conflictos y personas', () => {
  /** El mismo set de casos corre contra lib/offline-queue.ts y contra public/sw.js. */
  const impls: Array<[string, () => typeof replayQueue]> = [
    ['lib', () => replayQueue],
    ['sw.js', () => loadServiceWorker().api.replayQueue],
  ];
  function failStore(items: Array<Omit<QueuedRequest, 'id'>>) {
    const base = memoryStore(items);
    const failed: Array<{ url: string; status: number }> = [];
    const conflicts: string[] = [];
    return {
      ...base,
      fail: async (it: QueuedRequest, status: number) => {
        failed.push({ url: it.url, status });
        await base.remove(it.id);
      },
      conflict: async (it: QueuedRequest) => {
        conflicts.push(it.url);
      },
      failed,
      conflicts,
    };
  }

  for (const [name, impl] of impls) {
    it(`${name}: un 4xx aparta el cambio (reintentar o descartar) y sigue con el resto`, async () => {
      const store = failStore([item('/a', 1), item('/b', 2)]);
      const res = await withMe(impl())(store, async (r) => (r.url === '/a' ? { ok: false, status: 403 } : { ok: true, status: 200 }));
      expect(res).toEqual({ done: 1, failed: 1, conflicts: 0, remaining: 0 });
      expect(store.failed).toEqual([{ url: '/a', status: 403 }]);
      expect(store.left()).toEqual([]);
    });

    it(`${name}: un 5xx o 429 corta sin perder nada y pide reintentar`, async () => {
      for (const status of [500, 503, 429]) {
        const store = failStore([item('/a', 1), item('/b', 2)]);
        const res = await withMe(impl())(store, async () => ({ ok: false, status }));
        expect(res).toEqual({ done: 0, failed: 0, conflicts: 0, remaining: 2, retry: true });
        expect(store.left().map((r) => r.url)).toEqual(['/a', '/b']);
      }
    });

    it(`${name}: la misma alta en curso en el servidor (x-zs-retry) también espera`, async () => {
      const store = failStore([item('/a', 1)]);
      const res = await withMe(impl())(store, async () => ({ ok: false, status: 409, retry: true }));
      expect(res.retry).toBe(true);
      expect(store.left()).toHaveLength(1);
    });

    it(`${name}: un DELETE que da 404 ya estaba hecho`, async () => {
      const store = failStore([{ ...item('/a', 1), method: 'DELETE' }]);
      const res = await withMe(impl())(store, async () => ({ ok: false, status: 404 }));
      expect(res).toEqual({ done: 1, failed: 0, conflicts: 0, remaining: 0 });
      expect(store.failed).toEqual([]);
    });

    it(`${name}: guardado sobre una versión más nueva se anota como conflicto`, async () => {
      const store = failStore([item('/a', 1), item('/b', 2)]);
      const res = await withMe(impl())(store, async (r) => ({ ok: true, status: 200, conflict: r.url === '/b' }));
      expect(res).toEqual({ done: 2, failed: 0, conflicts: 1, remaining: 0 });
      expect(store.conflicts).toEqual(['/b']);
    });

    it(`${name}: lo de otra persona no se manda con esta sesión`, async () => {
      const store = failStore([
        { ...item('/ajeno', 1), owner: 'otra:ws1' },
        { ...item('/mio', 2), owner: 'yo:ws1' },
      ]);
      const seen: string[] = [];
      const res = await impl()(
        store,
        async (r) => {
          seen.push(r.url);
          return { ok: true, status: 200 };
        },
        'yo:ws1',
      );
      expect(seen).toEqual(['/mio']);
      expect(res).toEqual({ done: 1, failed: 0, conflicts: 0, remaining: 1, blocked: true });
      expect(store.left().map((r) => r.url)).toEqual(['/ajeno']);
    });

    it(`${name}: lo encolado sin persona no se manda con ninguna sesión`, async () => {
      const store = failStore([{ ...item('/viejo', 1), owner: undefined }, item('/mio', 2)]);
      const seen: string[] = [];
      const res = await withMe(impl())(store, async (r) => {
        seen.push(r.url);
        return { ok: true, status: 200 };
      });
      expect(seen).toEqual(['/mio']);
      expect(res).toEqual({ done: 1, failed: 0, conflicts: 0, remaining: 1, blocked: true, unknown: 1 });
    });

    it(`${name}: sin sesión confirmada no se manda nada que tenga dueño`, async () => {
      const store = failStore([{ ...item('/a', 1), owner: 'yo:ws1' }]);
      const res = await withMe(impl())(store, async () => ({ ok: true, status: 200 }), null);
      expect(res.blocked).toBe(true);
      expect(store.left()).toHaveLength(1);
    });
  }
});

describe('isQueuedResponse', () => {
  it('reconoce solo el 202 del service worker', () => {
    expect(isQueuedResponse(new Response('{}', { status: 202, headers: { [QUEUED_HEADER]: '1' } }))).toBe(true);
    expect(isQueuedResponse(new Response('{}', { status: 202 }))).toBe(false);
    expect(isQueuedResponse(new Response('{}', { status: 201, headers: { [QUEUED_HEADER]: '1' } }))).toBe(false);
    expect(isQueuedResponse(null)).toBe(false);
  });
});

describe('public/sw.js', () => {
  const { api, events } = loadServiceWorker();

  it('escucha fetch, sync y mensajes', () => {
    expect(events).toEqual(expect.arrayContaining(['install', 'activate', 'fetch', 'sync', 'message']));
  });

  it('usa las mismas reglas que lib/offline-queue.ts', async () => {
    expect([...api.NEVER_QUEUE]).toEqual([...NEVER_QUEUE]);
    const cases: Array<[string, string, string | null]> = [
      ['/api/crm/activities', 'POST', 'application/json'],
      ['/api/crm/contacts/x', 'PATCH', 'application/json'],
      ['/api/crm/activities/x', 'DELETE', null],
      ['/api/crm/contacts', 'GET', null],
      ['/api/crm/emails', 'POST', 'application/json'],
      ['/api/crm/files', 'POST', 'multipart/form-data'],
      ['/api/crm/emails/draft', 'POST', 'application/json'],
      ['/api/links', 'POST', 'application/json'],
      ['/api/track/issues/x', 'PATCH', 'application/json'],
      ['/api/track/projects/x/issues', 'POST', 'application/json'],
      ['/api/track/issues/x/attachments', 'POST', 'application/json'],
      ['/api/track/issues/x/ai/summary', 'POST', 'application/json'],
      ['/api/track/export', 'POST', 'application/json'],
      ['/api/track/issues/x', 'DELETE', null],
      ['/api/docs/pages/x', 'PATCH', 'application/json'],
    ];
    for (const [p, m, ct] of cases) {
      expect(api.shouldQueue(p, m, ct, false)).toBe(shouldQueue(p, m, ct, false));
      expect(api.shouldQueue(p, m, ct, true)).toBe(shouldQueue(p, m, ct, true));
    }
    expect([...(api as unknown as { NEVER_OPT_IN: string[] }).NEVER_OPT_IN]).toEqual([...NEVER_OPT_IN]);
    expect([...(api as unknown as { OPT_IN_PREFIXES: string[] }).OPT_IN_PREFIXES]).toEqual([...OPT_IN_PREFIXES]);

    const store = memoryStore([item('/b', 2), item('/a', 1)]);
    const seen: string[] = [];
    const res = await withMe(api.replayQueue)(store, async (r) => {
      seen.push(r.url);
      return { ok: true, status: 200 };
    });
    expect(seen).toEqual(['/a', '/b']);
    expect(res.remaining).toBe(0);
  });
});

describe('clearOfflineData (cerrar sesión)', () => {
  it('borra todas las cachés del service worker, también las zs-app-* con las vistas de la persona', async () => {
    const sw = readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
    const version = /const VERSION = '([^']+)'/.exec(sw)?.[1] ?? '';
    const names = [`${version}-pages`, `${version}-static`, 'zs-crm-v1-pages', 'otra-app'];
    expect(names.filter(isOfflineCacheName)).toEqual([`${version}-pages`, `${version}-static`, 'zs-crm-v1-pages']);
    const deleted: string[] = [];
    const g = globalThis as unknown as Record<string, unknown>;
    const prev = { window: g.window, caches: g.caches };
    g.window = globalThis;
    g.caches = { keys: async () => names, delete: async (k: string) => (deleted.push(k), true) };
    try {
      await clearOfflineData();
    } finally {
      g.window = prev.window;
      g.caches = prev.caches;
    }
    expect(deleted.sort()).toEqual([`${version}-pages`, `${version}-static`, 'zs-crm-v1-pages'].sort());
  });
});
