/**
 * Lines e Inbox sin conexión: lo escrito sin red queda en cola (con el reloj), sobrevive a recargar, se puede borrar
 * antes de que salga y sale solo al volver la red, en orden y una sola vez (también con dos pestañas).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { offlineOutbox, unsentStore } from '@/lib/optimistic-send';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

/** Web Locks de una sola pestaña-proceso: un pedido a la vez por nombre, en orden de llegada. */
function fakeLocks() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request(name: string, fn: () => Promise<unknown>) {
      const prev = tails.get(name) ?? Promise.resolve();
      const run = prev.then(fn, fn);
      tails.set(name, run.catch(() => undefined));
      return run;
    },
  };
}

let net = { onLine: true, locks: fakeLocks() as unknown };

function setup() {
  const storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
  net = { onLine: true, locks: fakeLocks() };
  vi.stubGlobal('navigator', net);
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cola sin conexión (Lines e Inbox)', () => {
  it('lo encolado sobrevive a recargar como "en cola" (no como no enviado), y se puede borrar antes de que salga', () => {
    setup();
    const tab = unsentStore<string>('zs:test-outbox-1', { persist: 'local' });
    tab.setOwner('persona-a');
    const a = tab.add({ chatId: 'c1', body: 'uno', replyToId: null }, 'queued');
    const b = tab.add({ chatId: 'c1', body: 'dos', replyToId: null }, 'queued');
    // Recarga: otro store sobre el mismo localStorage.
    const after = unsentStore<string>('zs:test-outbox-1', { persist: 'local' });
    after.setOwner('persona-a');
    expect(after.list('c1').map((u) => [u.body, u.status])).toEqual([
      ['uno', 'queued'],
      ['dos', 'queued'],
    ]);
    expect(after.queued().map((u) => u.clientId)).toEqual([a.clientId, b.clientId]);
    // Borrar antes de que salga.
    after.remove(a.clientId);
    expect(after.queued().map((u) => u.body)).toEqual(['dos']);
    // De otra persona: no se ve ni se manda.
    const other = unsentStore<string>('zs:test-outbox-1', { persist: 'local' });
    other.setOwner('persona-b');
    expect(other.queued()).toEqual([]);
  });

  it('al volver la red salen en orden, una vez cada uno y con su clientId; si se corta a mitad, lo que falta espera', async () => {
    setup();
    const store = unsentStore<string>('zs:test-outbox-2', { persist: 'local' });
    store.setOwner('persona-a');
    net.onLine = false;
    const ids = ['uno', 'dos', 'tres'].map((body) => store.add({ chatId: 'c1', body, replyToId: null }, 'queued').clientId);
    const sent: string[] = [];
    const outbox = offlineOutbox(store, 'zs-outbox:test-2', async (cid) => {
      const e = store.pending(cid);
      if (!e) return;
      await Promise.resolve();
      if (!net.onLine) return store.queue(cid);
      sent.push(e.body);
      // Después del primero se corta la red.
      if (e.body === 'uno') net.onLine = false;
      store.saved(cid, `m-${e.body}`);
    });
    // Sin red no sale nada.
    await outbox.flush();
    expect(sent).toEqual([]);
    net.onLine = true;
    await outbox.flush();
    expect(sent).toEqual(['uno']);
    expect(store.queued().map((u) => u.clientId)).toEqual(ids.slice(1));
    net.onLine = true;
    await outbox.flush();
    expect(sent).toEqual(['uno', 'dos', 'tres']);
    expect(store.queued()).toEqual([]);
  });

  it('dos pestañas: cada mensaje sale una sola vez y en orden', async () => {
    setup();
    const tabA = unsentStore<string>('zs:test-outbox-3', { persist: 'local' });
    const tabB = unsentStore<string>('zs:test-outbox-3', { persist: 'local' });
    tabA.setOwner('persona-a');
    tabB.setOwner('persona-a');
    const bodies = ['uno', 'dos', 'tres', 'cuatro'];
    for (const body of bodies) tabA.add({ chatId: 'c1', body, replyToId: null }, 'queued');
    const server: string[] = [];
    const sender = (store: typeof tabA) => async (cid: string) => {
      const e = store.pending(cid);
      if (!e) return;
      await new Promise((r) => setTimeout(r, 2));
      server.push(e.body);
      store.saved(cid, 'ok');
    };
    const a = offlineOutbox(tabA, 'zs-outbox:test-3', sender(tabA));
    const b = offlineOutbox(tabB, 'zs-outbox:test-3', sender(tabB));
    // Vuelve la red en las dos a la vez.
    await Promise.all([a.flush(), b.flush()]);
    expect(server).toEqual(bodies);
    expect(tabA.queued()).toEqual([]);
    expect(tabB.queued()).toEqual([]);
  });

  it('uno que el servidor rechaza queda como no enviado (reintentar) y no frena a los que siguen', async () => {
    setup();
    const store = unsentStore<string>('zs:test-outbox-4', { persist: 'local' });
    store.setOwner('persona-a');
    const bad = store.add({ chatId: 'c1', body: 'rechazado', replyToId: null }, 'queued');
    store.add({ chatId: 'c1', body: 'bien', replyToId: null }, 'queued');
    const sent: string[] = [];
    const outbox = offlineOutbox(store, 'zs-outbox:test-4', async (cid) => {
      const e = store.pending(cid);
      if (!e) return;
      if (e.body === 'rechazado') return store.fail(cid, 'invalid_input');
      sent.push(e.body);
      store.saved(cid, 'ok');
    });
    await outbox.flush();
    expect(sent).toEqual(['bien']);
    expect(store.get(bad.clientId)).toMatchObject({ status: 'failed', error: 'invalid_input' });
    // Al recargar sigue como no enviado, con su error.
    const after = unsentStore<string>('zs:test-outbox-4', { persist: 'local' });
    after.setOwner('persona-a');
    expect(after.list('c1').map((u) => [u.body, u.status, u.error])).toEqual([['rechazado', 'failed', 'invalid_input']]);
  });

  it('un envío que se cortó a mitad pasa a la cola con el MISMO clientId', () => {
    setup();
    const store = unsentStore<string>('zs:test-outbox-5', { persist: 'local' });
    store.setOwner('persona-a');
    const cid = 'abcdefgh12345678';
    store.add({ chatId: 'c1', body: 'a mitad', replyToId: null, clientId: cid }, 'queued');
    store.add({ chatId: 'c1', body: 'a mitad', replyToId: null, clientId: cid }, 'queued');
    expect(store.queued().map((u) => u.clientId)).toEqual([cid]);
  });
});

describe('Lines: sendLinesText sin red', () => {
  it('sin red no pide nada: queda en cola; al volver la red sale con su clientId, en orden', async () => {
    setup();
    vi.stubGlobal('sessionStorage', memoryStorage());
    const calls: Array<{ body: string; clientId: string }> = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const b = JSON.parse(init.body) as { body: string; clientId: string };
      calls.push(b);
      return { ok: true, json: async () => ({ id: `m-${b.clientId}`, status: 'sent', meta: { cid: b.clientId } }) };
    });
    const { unsentLines, sendLinesText, linesOutbox } = await import('@/components/groups/optimistic');
    unsentLines.setOwner('persona-a');
    net.onLine = false;
    const one = unsentLines.add({ chatId: 'chat-q', body: 'uno', replyToId: null });
    await sendLinesText(one.clientId);
    const two = unsentLines.add({ chatId: 'chat-q', body: 'dos', replyToId: null });
    await sendLinesText(two.clientId);
    expect(calls).toEqual([]);
    expect(unsentLines.list('chat-q').map((u) => u.status)).toEqual(['queued', 'queued']);
    // Vuelve la red, pero alguien escribe antes de que salga la cola: va detrás, no se adelanta.
    net.onLine = true;
    const three = unsentLines.add({ chatId: 'chat-q', body: 'tres', replyToId: null });
    await sendLinesText(three.clientId);
    await linesOutbox.flush();
    await vi.waitFor(() => expect(calls.map((c) => c.body)).toEqual(['uno', 'dos', 'tres']));
    expect(calls.map((c) => c.clientId)).toEqual([one.clientId, two.clientId, three.clientId]);
    expect(unsentLines.list('chat-q')).toEqual([]);
  });
});
