import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';
import {
  NEVER_QUEUE,
  QUEUED_HEADER,
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

const item = (url: string, createdAt: number): Omit<QueuedRequest, 'id'> => ({
  url,
  method: 'POST',
  contentType: 'application/json',
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
});

describe('replayQueue', () => {
  it('reenvía en orden de creación y vacía la cola', async () => {
    const store = memoryStore([item('/b', 2), item('/a', 1), item('/c', 3)]);
    const seen: string[] = [];
    const res = await replayQueue(store, async (r) => {
      seen.push(r.url);
      return { ok: true, status: 200 };
    });
    expect(seen).toEqual(['/a', '/b', '/c']);
    expect(res).toEqual({ done: 3, failed: 0, remaining: 0 });
    expect(store.left()).toEqual([]);
  });

  it('se corta si vuelve a caer la red y deja el resto para después', async () => {
    const store = memoryStore([item('/a', 1), item('/b', 2), item('/c', 3)]);
    let calls = 0;
    const res = await replayQueue(store, async () => {
      calls += 1;
      if (calls === 2) throw new TypeError('Failed to fetch');
      return { ok: true, status: 201 };
    });
    expect(res).toEqual({ done: 1, failed: 0, remaining: 2 });
    expect(store.left().map((r) => r.url)).toEqual(['/b', '/c']);
  });

  it('una respuesta de error del servidor saca el item y se cuenta como fallido', async () => {
    const store = memoryStore([item('/a', 1), item('/b', 2)]);
    const res = await replayQueue(store, async (r) => (r.url === '/a' ? { ok: false, status: 404 } : { ok: true, status: 200 }));
    expect(res).toEqual({ done: 1, failed: 1, remaining: 0 });
    expect(store.left()).toEqual([]);
  });
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
    ];
    for (const [p, m, ct] of cases) expect(api.shouldQueue(p, m, ct)).toBe(shouldQueue(p, m, ct));

    const store = memoryStore([item('/b', 2), item('/a', 1)]);
    const seen: string[] = [];
    const res = await api.replayQueue(store, async (r) => {
      seen.push(r.url);
      return { ok: true, status: 200 };
    });
    expect(seen).toEqual(['/a', '/b']);
    expect(res.remaining).toBe(0);
  });
});
