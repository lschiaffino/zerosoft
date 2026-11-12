/**
 * Lines e Inbox: el mensaje que se manda aparece al apretar Enter
 * (lib/optimistic-send.ts). La burbuja provisoria, cuándo se va, qué pasa si
 * el envío falla y el orden de los envíos. Lógica pura; textos inventados.
 */
import { describe, expect, it, vi } from 'vitest';
import { UNSENT_LINES_KEY, cleanClientId, dropSettled, isTempId, newClientId, sendQueue, sendQueueFor, sendsInFlight, tempIdFor, unsentStore, type Unsent } from '@/lib/optimistic-send';
import { SEND_TIMEOUT_MS, cidOf, linesDraftKey, linesQueue as linesQueueFor, sendLinesText, tempMessage, unsentLines, withUnsent } from '@/components/groups/optimistic';
import { applyPending, keepPending, pendingSends, tempInboxMessage, withoutStale } from '@/components/inbox/wa/pending';
import type { MessageDto as LinesMessage } from '@/lib/groups';
import type { MessageDto as InboxMessage } from '@/lib/inbox/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('clientId', () => {
  it('uno nuevo pasa la validación del servidor; lo raro no se guarda', () => {
    const id = newClientId();
    expect(cleanClientId(id)).toBe(id);
    expect(isTempId(tempIdFor(id))).toBe(true);
    expect(isTempId(id)).toBe(false);
    for (const bad of ['', 'corto', '<script>alert(1)</script>', 'con espacios adentro', 'x'.repeat(41), 42, null, undefined, { a: 1 }]) expect(cleanClientId(bad)).toBeUndefined();
  });
});

const unsent = (over: Partial<Unsent> = {}): Unsent => ({ clientId: 'cid-00000001', owner: 'yo', chatId: 'c1', body: 'hola', replyToId: null, status: 'pending', error: '', createdAt: '2026-11-10T10:00:00.000Z', ...over });

describe('Lines: la burbuja provisoria', () => {
  const real = (id: string, cid?: string, createdAt = '2026-11-10T09:00:00.000Z'): LinesMessage => ({ ...tempMessage(unsent({ clientId: cid ?? 'x' }), 'yo'), id, status: 'sent', createdAt, meta: cid ? { cid } : {} });

  it('nace como saliente, "enviando", mía y con su clientId; la que no salió, como no enviada con su error', () => {
    const t = tempMessage(unsent({ replyToId: 'm9' }), 'yo');
    expect(t).toMatchObject({ id: 'tmp-cid-00000001', direction: 'out', status: 'pending', authorId: 'yo', body: 'hola', replyToId: 'm9', chatId: 'c1' });
    expect(cidOf(t)).toBe('cid-00000001');
    expect(tempMessage(unsent({ status: 'failed', error: 'rate_limited' }), 'yo')).toMatchObject({ status: 'failed', error: 'rate_limited' });
  });

  it('el hilo muestra lo pendiente de ese chat al final, y lo saca cuando llega su mensaje guardado', () => {
    const a = unsent({ clientId: 'cid-aaaaaaa1', body: 'uno', createdAt: '2026-11-10T10:00:01.000Z' });
    const b = unsent({ clientId: 'cid-bbbbbbb2', body: 'dos', createdAt: '2026-11-10T10:00:02.000Z', status: 'failed', error: 'network' });
    const old = real('m1');
    const first = withUnsent([old], [a, b], 'yo');
    expect(first.messages.map((m) => [m.id, m.status])).toEqual([
      ['m1', 'sent'],
      ['tmp-cid-aaaaaaa1', 'pending'],
      ['tmp-cid-bbbbbbb2', 'failed'],
    ]);
    expect(first.settled).toEqual([]);
    // Llega el guardado de "uno" (por la respuesta o por el aviso en vivo): su burbuja se va, la otra sigue.
    const savedA = real('m2', 'cid-aaaaaaa1', '2026-11-10T10:00:01.500Z');
    const second = withUnsent([...first.messages, savedA], [a, b], 'yo');
    expect(second.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'tmp-cid-bbbbbbb2']);
    expect(second.settled).toEqual(['cid-aaaaaaa1']);
    // El mensaje de otra persona con el mismo texto no la saca: solo cuenta el clientId.
    expect(withUnsent([{ ...real('m3'), body: 'dos' }], [b], 'yo').messages.map((m) => m.id)).toEqual(['m3', 'tmp-cid-bbbbbbb2']);
    // Ya no hay nada pendiente: las provisorias que quedaban se van; sin cambios devuelve la misma lista.
    expect(withUnsent(second.messages, [], 'yo').messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    const same = [old];
    expect(withUnsent(same, [], 'yo').messages).toBe(same);
    // dropSettled (lo usa Inbox) hace lo mismo sobre una lista ya armada.
    const t = tempMessage(a, 'yo');
    expect(dropSettled([old, t], [savedA], cidOf).map((m) => m.id)).toEqual(['m1']);
    expect(dropSettled([old, t], [old], cidOf)).toHaveLength(2);
  });
});

describe('lo que no salió no se pierde (M3)', () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
  }

  it('queda por chat fuera del componente: falla con el chat cerrado y al volver sigue ahí, como no enviado', () => {
    const storage = memoryStorage();
    vi.stubGlobal('sessionStorage', storage);
    const store = unsentStore<{ id: string }>('test-unsent-1');
    store.setOwner('persona-a');
    const seen: string[] = [];
    store.subscribe((e) => seen.push(`${e.type}:${e.chatId}`));
    const a = store.add({ chatId: 'chat-a', body: 'no te olvides del turno', replyToId: null });
    store.add({ chatId: 'chat-b', body: 'otro chat', replyToId: 'm1' });
    expect(store.list('chat-a').map((u) => [u.body, u.status])).toEqual([['no te olvides del turno', 'pending']]);
    // La persona se fue a otro chat y el envío falló (límite, sin red, 5xx): nadie del hilo lo estaba mirando.
    store.fail(a.clientId, 'rate_limited');
    expect(seen).toEqual(['added:chat-a', 'added:chat-b', 'failed:chat-a']);
    // Vuelve al chat: el texto está, como no enviado, con su error. El del otro chat no se mezcla.
    expect(store.list('chat-a')).toMatchObject([{ body: 'no te olvides del turno', status: 'failed', error: 'rate_limited' }]);
    expect(store.list('chat-b')).toHaveLength(1);
    // Reintenta: la misma burbuja vuelve a "enviando"; cuando el servidor lo guarda, sale de lo pendiente.
    expect(store.pending(a.clientId)).toMatchObject({ status: 'pending', error: '' });
    store.saved(a.clientId, { id: 'm-guardado' });
    expect(store.list('chat-a')).toEqual([]);
    expect(seen.slice(-2)).toEqual(['pending:chat-a', 'saved:chat-a']);
    // Quitar a mano.
    store.remove(store.list('chat-b')[0].clientId);
    expect(storage.getItem('test-unsent-1')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('sobrevive a una recarga de la página: lo que estaba saliendo vuelve como no enviado (no se sabe si salió)', () => {
    const storage = memoryStorage();
    vi.stubGlobal('sessionStorage', storage);
    const before = unsentStore<{ id: string }>('test-unsent-2');
    before.setOwner('persona-a');
    const sending = before.add({ chatId: 'chat-a', body: 'estaba saliendo', replyToId: null });
    const failed = before.add({ chatId: 'chat-a', body: 'ya había fallado', replyToId: null });
    before.fail(failed.clientId, 'not_connected');
    // Otra carga de la página: un store nuevo sobre el mismo sessionStorage.
    const after = unsentStore<{ id: string }>('test-unsent-2');
    after.setOwner('persona-a');
    expect(after.list('chat-a').map((u) => [u.body, u.status, u.error])).toEqual([
      ['estaba saliendo', 'failed', 'interrupted'],
      ['ya había fallado', 'failed', 'not_connected'],
    ]);
    // Si el servidor ya lo tenía (salió justo antes de recargar), el hilo lo reconoce por su clientId y lo saca.
    const saved = { ...tempMessage(after.get(sending.clientId)!, 'yo'), id: 'm-real', status: 'sent' };
    const shown = withUnsent([saved], after.list('chat-a'), 'yo');
    expect(shown.settled).toEqual([sending.clientId]);
    expect(shown.messages.map((m) => m.id)).toEqual(['m-real', `tmp-${failed.clientId}`]);
    // Basura en sessionStorage no rompe nada.
    storage.setItem('test-unsent-3', '{"no":"es una lista"}');
    expect(unsentStore('test-unsent-3').list('x')).toEqual([]);
    storage.setItem('test-unsent-4', JSON.stringify([{ clientId: '<script>', chatId: 'x', body: 'y' }, null, 7]));
    expect(unsentStore('test-unsent-4').list('x')).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('sendLinesText: termina aunque nadie mire; lo guardado sale de lo pendiente y lo que falla queda con su error', async () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    const calls: Array<Record<string, unknown>> = [];
    let reply: { ok: boolean; body: unknown } = { ok: false, body: { error: 'rate_limited' } };
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      calls.push(JSON.parse(init.body));
      return { ok: reply.ok, json: async () => reply.body };
    });
    const events: string[] = [];
    unsentLines.setOwner('persona-a');
    const off = unsentLines.subscribe((e) => events.push(e.type));
    const entry = unsentLines.add({ chatId: 'chat-m3', body: 'hola', replyToId: null });
    sendLinesText(entry.clientId);
    await vi.waitFor(() => expect(unsentLines.get(entry.clientId)?.status).toBe('failed'));
    expect(unsentLines.get(entry.clientId)?.error).toBe('rate_limited');
    expect(calls[0]).toMatchObject({ body: 'hola', clientId: entry.clientId, note: false });
    // Reintento: el MISMO clientId (el servidor lo guarda en meta.cid y el hilo lo reconoce).
    reply = { ok: true, body: { id: 'm-ok', status: 'sent', meta: { cid: entry.clientId } } };
    sendLinesText(entry.clientId);
    await vi.waitFor(() => expect(unsentLines.get(entry.clientId)).toBeUndefined());
    expect(calls[1].clientId).toBe(entry.clientId);
    expect(events).toEqual(['added', 'pending', 'failed', 'pending', 'saved']);
    // Sin red.
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    const other = unsentLines.add({ chatId: 'chat-m3', body: 'sin red', replyToId: null });
    sendLinesText(other.clientId);
    await vi.waitFor(() => expect(unsentLines.get(other.clientId)?.error).toBe('network'));
    unsentLines.remove(other.clientId);
    off();
    vi.unstubAllGlobals();
  });
});

describe('Inbox: la burbuja provisoria y lo que vuelve del servidor, siempre en SU chat', () => {
  const msg = (id: string, cid?: string): InboxMessage => ({ ...tempInboxMessage(cid ?? 'x', 'hola'), id, status: 'sent', meta: cid ? { cid } : null });
  const detail = (messages: InboxMessage[], id = 't1') => ({ thread: { id }, messages, more: false });
  /** Una burbuja cuyo envío está en curso (como cuando el composer la anuncia). */
  const sending = (cid: string, body = 'hola', threadId = 't1') => {
    const temp = tempInboxMessage(cid, body);
    pendingSends.emit({ type: 'add', threadId, message: temp });
    return temp;
  };

  it('se suma a la conversación abierta de ese chat y a ninguna otra', () => {
    const temp = tempInboxMessage('cid-00000001', 'hola');
    expect(temp).toMatchObject({ id: 'tmp-cid-00000001', fromMe: true, status: 'pending', body: 'hola' });
    const d = detail([msg('m1')]);
    const added = applyPending(d, { type: 'add', threadId: 't1', message: temp })!;
    expect(added.messages.map((m) => m.id)).toEqual(['m1', temp.id]);
    expect(applyPending(added, { type: 'add', threadId: 't1', message: temp })!.messages).toHaveLength(2);
    expect(applyPending(d, { type: 'add', threadId: 'otro', message: temp })).toBe(d);
    expect(applyPending(null, { type: 'add', threadId: 't1', message: temp })).toBeNull();
    expect(applyPending(added, { type: 'drop', threadId: 't1', id: temp.id })!.messages.map((m) => m.id)).toEqual(['m1']);
  });

  it('M2: la respuesta de un envío al chat A no se pinta en el chat B que está a la vista', () => {
    const tempA = sending('cid-aaaaaaa1', 'para A', 'A');
    const openB = detail([msg('b1'), msg('b2')], 'B');
    const pageOfA = [msg('a1'), msg('a2', 'cid-aaaaaaa1')];
    // Enter en A, se abre B, llega la respuesta del envío de A.
    const sent = { type: 'sent' as const, threadId: 'A', messages: pageOfA, id: tempA.id };
    pendingSends.emit(sent);
    expect(applyPending(openB, sent)).toBe(openB);
    // La copia guardada de A sí se pone al día (sin la provisoria: su envío terminó).
    const keptA = detail([msg('a1'), tempA], 'A');
    expect(applyPending(keptA, sent)!.messages.map((m) => m.id)).toEqual(['a1', 'a2']);
    // Lo mismo si el envío de A falla con B abierto: B no cambia y la copia de A pierde la burbuja.
    const tempA2 = sending('cid-aaaaaaa2', 'otra para A', 'A');
    const drop = { type: 'drop' as const, threadId: 'A', id: tempA2.id };
    pendingSends.emit(drop);
    expect(applyPending(openB, drop)).toBe(openB);
    expect(applyPending(detail([msg('a1'), tempA2], 'A'), drop)!.messages.map((m) => m.id)).toEqual(['a1']);
  });

  it('sigue a la vista si la conversación se relee a mitad del envío; se va cuando llega su mensaje o termina su envío', () => {
    const temp = sending('cid-00000001');
    const other = sending('cid-00000002', 'chau');
    const shown = detail([msg('m1'), temp, other]);
    const reread = keepPending(shown, detail([msg('m1'), msg('m2')]));
    expect(reread.messages.map((m) => m.id)).toEqual(['m1', 'm2', temp.id, other.id]);
    const settled = keepPending(reread, detail([msg('m1'), msg('m2'), msg('m3', 'cid-00000001')]));
    expect(settled.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', other.id]);
    // La respuesta del primero trae la página del servidor: el segundo, que sigue saliendo, queda a la vista.
    const afterFirst = applyPending(reread, { type: 'sent', threadId: 't1', messages: [msg('m1'), msg('m2'), msg('m3', 'cid-00000001')], id: temp.id })!;
    expect(afterFirst.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', other.id]);
    const next = detail([msg('m1')]);
    expect(keepPending(detail([msg('m0')]), next)).toBe(next);
    const elsewhere = detail([msg('z1')], 't2');
    expect(keepPending(shown, elsewhere)).toBe(elsewhere);
    expect(keepPending(null, next)).toBe(next);
    pendingSends.emit({ type: 'drop', threadId: 't1', id: other.id });
  });

  it('M6: una burbuja cuyo envío ya terminó no vuelve desde la copia guardada de un chat', () => {
    const temp = sending('cid-0000000a', 'se cae', 'A');
    const kept = detail([msg('a1'), temp], 'A');
    // Mientras sale, la copia guardada la conserva.
    expect(withoutStale(kept)).toBe(kept);
    // El envío terminó (falló) con otro chat abierto y la copia no se llegó a tocar: al volver no hay "enviando".
    pendingSends.emit({ type: 'drop', threadId: 'A', id: temp.id });
    expect(pendingSends.active(temp.id)).toBe(false);
    expect(withoutStale(kept).messages.map((m) => m.id)).toEqual(['a1']);
    // Y una relectura del servidor tampoco la arrastra.
    expect(keepPending(kept, detail([msg('a1'), msg('a2')], 'A')).messages.map((m) => m.id)).toEqual(['a1', 'a2']);
  });
});

describe('la cola de envíos de un chat', () => {
  it('salen de a uno y en el orden en que se escribieron, aunque el primero tarde más', async () => {
    const run = sendQueue();
    const log: string[] = [];
    const job = (name: string, ms: number) => async () => {
      log.push(`sale ${name}`);
      await sleep(ms);
      log.push(`llegó ${name}`);
      return name;
    };
    const results = await Promise.all([run(job('a', 40)), run(job('b', 5)), run(job('c', 1))]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['sale a', 'llegó a', 'sale b', 'llegó b', 'sale c', 'llegó c']);
  });

  it('M12: todo lo que se manda a un chat comparte una cola (un archivo no se adelanta a un texto lento), y avisa al cerrar', async () => {
    const added: string[] = [];
    const removed: string[] = [];
    vi.stubGlobal('window', { addEventListener: (t: string) => added.push(t), removeEventListener: (t: string) => removed.push(t) });
    const log: string[] = [];
    // El texto sale por un lado del código y el archivo por otro: los dos piden la cola del mismo chat.
    const text = sendQueueFor('lines:chat-1')(async () => {
      log.push('sale texto');
      await sleep(40);
      log.push('llegó texto');
    });
    const file = sendQueueFor('lines:chat-1')(async () => {
      log.push('sale archivo');
    });
    // Otro chat no espera a este.
    const elsewhere = sendQueueFor('lines:chat-2')(async () => {
      log.push('sale otro chat');
    });
    expect(sendsInFlight()).toBe(3);
    // Con envíos saliendo, cerrar la pestaña pide confirmación.
    expect(added).toEqual(['beforeunload']);
    await Promise.all([text, file, elsewhere]);
    expect(log).toEqual(['sale texto', 'sale otro chat', 'llegó texto', 'sale archivo']);
    await sleep(0);
    expect(sendsInFlight()).toBe(0);
    expect(removed).toEqual(['beforeunload']);
    vi.unstubAllGlobals();
  });

  it('uno que falla no frena a los que siguen, y su error llega a quien lo mandó', async () => {
    const run = sendQueue();
    const log: string[] = [];
    const bad = run(async () => {
      log.push('a');
      throw new Error('sin red');
    });
    const good = run(async () => {
      log.push('b');
      return 'ok';
    });
    await expect(bad).rejects.toThrow('sin red');
    expect(await good).toBe('ok');
    expect(log).toEqual(['a', 'b']);
  });
});

describe('ronda 3: de quién es lo que no salió, reintentos y tiempos', () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      data,
    };
  }

  it('5: lo que no salió es de quien lo escribió; otra persona en la misma pestaña no lo ve ni lo puede mandar', () => {
    const storage = memoryStorage();
    vi.stubGlobal('sessionStorage', storage);
    const a = unsentStore<{ id: string }>('test-owner');
    a.setOwner('persona-a');
    const mine = a.add({ chatId: 'chat-1', body: 'de A', replyToId: null });
    a.fail(mine.clientId, 'network');
    expect(a.list('chat-1')).toHaveLength(1);
    // Sale A y entra B en la misma pestaña (sin recargar, o recargando).
    a.setOwner('persona-b');
    expect(a.list('chat-1')).toEqual([]);
    expect(a.get(mine.clientId)).toBeUndefined();
    expect(a.pending(mine.clientId)).toBeUndefined();
    // Y se descartó del almacenamiento: no vuelve aunque A entre de nuevo.
    const reload = unsentStore<{ id: string }>('test-owner');
    reload.setOwner('persona-a');
    expect(reload.list('chat-1')).toEqual([]);
    // Sin saber todavía quién es, no se muestra nada.
    const unknown = unsentStore<{ id: string }>('test-owner');
    expect(unknown.list('chat-1')).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('5: los borradores de Lines llevan a la persona en la clave, y al cerrar sesión se borran con lo que no salió', async () => {
    expect(linesDraftKey('persona-a', 'chat-1')).not.toBe(linesDraftKey('persona-b', 'chat-1'));
    const storage = memoryStorage();
    // sessionStorage con Object.keys como el del navegador.
    const proxy = new Proxy(storage, { ownKeys: () => [...storage.data.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
    storage.setItem(UNSENT_LINES_KEY, '[]');
    storage.setItem(linesDraftKey('persona-a', 'chat-1'), 'borrador de A');
    storage.setItem('otra-cosa', 'queda');
    vi.stubGlobal('sessionStorage', proxy);
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('window', {});
    const { clearOfflineData } = await import('@/lib/offline-queue');
    await clearOfflineData().catch(() => undefined);
    expect(storage.getItem(UNSENT_LINES_KEY)).toBeNull();
    expect(storage.getItem(linesDraftKey('persona-a', 'chat-1'))).toBeNull();
    expect(storage.getItem('otra-cosa')).toBe('queda');
    vi.unstubAllGlobals();
  });

  it('6: dos clics en reintentar mandan un solo pedido', async () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    let calls = 0;
    let release: () => void = () => {};
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      calls++;
      await new Promise<void>((r) => (release = r));
      return { ok: true, json: async () => ({ id: 'm-1', status: 'sent', meta: { cid: JSON.parse(init.body).clientId } }) };
    });
    unsentLines.setOwner('persona-a');
    const entry = unsentLines.add({ chatId: 'chat-r3', body: 'hola', replyToId: null });
    sendLinesText(entry.clientId);
    sendLinesText(entry.clientId);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBe(1);
    release();
    await vi.waitFor(() => expect(unsentLines.get(entry.clientId)).toBeUndefined());
    expect(calls).toBe(1);
    vi.unstubAllGlobals();
  });

  it('7: un envío que no responde queda como no enviado a los 30 s y no traba la cola del chat', async () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // fetch que nunca responde, salvo que lo corten.
    vi.stubGlobal('fetch', (_url: string, init: { signal?: AbortSignal }) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })))),
    );
    // AbortSignal.timeout con los timers falsos.
    const realTimeout = AbortSignal.timeout;
    AbortSignal.timeout = (ms: number) => {
      const c = new AbortController();
      setTimeout(() => c.abort(), ms);
      return c.signal;
    };
    try {
      unsentLines.setOwner('persona-a');
      const stuck = unsentLines.add({ chatId: 'chat-t', body: 'colgado', replyToId: null });
      sendLinesText(stuck.clientId);
      let next = false;
      void linesQueueFor('chat-t')(async () => {
        next = true;
      });
      await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS - 1000);
      expect(unsentLines.get(stuck.clientId)?.status).toBe('pending');
      expect(next).toBe(false);
      await vi.advanceTimersByTimeAsync(2000);
      expect(unsentLines.get(stuck.clientId)).toMatchObject({ status: 'failed', error: 'network' });
      expect(next).toBe(true);
      unsentLines.remove(stuck.clientId);
    } finally {
      AbortSignal.timeout = realTimeout;
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('7: una relectura que no responde termina a los 15 s (el aviso en vivo no se queda esperando)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const realTimeout = AbortSignal.timeout;
    AbortSignal.timeout = (ms: number) => {
      const c = new AbortController();
      setTimeout(() => c.abort(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), ms);
      return c.signal;
    };
    vi.stubGlobal('fetch', (_url: string, init: { signal?: AbortSignal }) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    );
    try {
      const { fetchIfChanged, FETCH_TIMEOUT_MS } = await import('@/lib/conditional-fetch');
      let done: unknown = null;
      void fetchIfChanged('/api/inbox/state').then((r) => (done = r));
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 10);
      // Por tiempo es un error (se reintenta en la próxima), no "cortada por otra".
      expect(done).toMatchObject({ state: 'error' });
      // Cortada por quien la pidió: 'aborted', como siempre.
      const ctrl = new AbortController();
      let mine: unknown = null;
      void fetchIfChanged('/api/inbox/state', null, ctrl.signal).then((r) => (mine = r));
      ctrl.abort();
      await vi.advanceTimersByTimeAsync(1);
      expect(mine).toMatchObject({ state: 'aborted' });
    } finally {
      AbortSignal.timeout = realTimeout;
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
