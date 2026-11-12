/**
 * Inbox y Lines (navegador): la conexión del aviso en vivo que comparten la
 * lista y el chat abierto (lib/wa-live-client.ts). Una sola por app, stream
 * solo si el servidor lo habilita, releer al conectar y al reconectar tras un
 * corte (no tras el cierre ordenado de cada 4 minutos), y el ritmo de la
 * relectura de la lista bajo una tanda de avisos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HIDDEN_CLOSE_MS } from '@/lib/realtime-client';
import { GATHER_MS, LIST_FLOOR_MS, LIVE_POLL_MS, coalesced, joinWaLive, paced, type WaLiveChange } from '@/lib/wa-live-client';

class FakeEventSource {
  static CLOSED = 2;
  static all: FakeEventSource[] = [];
  readyState = 1;
  closed = false;
  onerror: (() => void) | null = null;
  listeners = new Map<string, (ev: unknown) => void>();
  constructor(public url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, fn: (ev: unknown) => void) {
    this.listeners.set(type, fn);
  }
  emit(type: string, data: unknown = {}) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) });
  }
  /** El servidor rechazó el stream (un proxy, un 429): el navegador lo da por cerrado. */
  refuse() {
    this.readyState = 2;
    this.onerror?.();
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

let visibility: 'visible' | 'hidden' = 'visible';
const docListeners = new Set<() => void>();
function setVisibility(v: 'visible' | 'hidden') {
  visibility = v;
  for (const fn of docListeners) fn();
}
type Poll = { events: Array<{ id: number; chatId: string; kind?: 'chat' | 'msg' }>; cursor: number; stream?: boolean };
let pollReply: Poll = { events: [], cursor: 7, stream: true };
let pollFails = 0;
const fetchMock = vi.fn(async (_url: string) => {
  if (pollFails > 0) {
    pollFails--;
    throw new Error('sin red');
  }
  return { ok: true, json: async () => pollReply };
});

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.all = [];
  visibility = 'visible';
  docListeners.clear();
  fetchMock.mockClear();
  pollReply = { events: [], cursor: 7, stream: true };
  pollFails = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('document', {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (_: string, fn: () => void) => docListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => docListeners.delete(fn),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function listener() {
  const got: WaLiveChange[] = [];
  const status: string[] = [];
  return { got, status, onChange: (c: WaLiveChange) => void got.push(c), onStatus: (s: string) => void status.push(s) };
}
/** Deja pasar la primera consulta (cursor y si hay stream). */
const booted = () => vi.advanceTimersByTimeAsync(0);
const urlOf = (i: number) => String(fetchMock.mock.calls[i][0]);
const streamUrl = (es: FakeEventSource) => es.url.replace(/tab=[^&]+/, 'tab=T');

describe('la conexión compartida', () => {
  it('la lista y el chat abierto usan una sola conexión por app; se cierra cuando sale el último', async () => {
    const list = listener();
    const chat = listener();
    const leaveList = joinWaLive('groups', list.onChange, list.onStatus);
    const leaveChat = joinWaLive('groups', chat.onChange, chat.onStatus);
    await booted();
    // Una consulta para saber desde dónde y si hay stream; después, un solo stream para los dos.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(0)).toBe('/api/groups/live?cursor=0');
    expect(FakeEventSource.all).toHaveLength(1);
    expect(streamUrl(FakeEventSource.all[0])).toBe('/api/groups/live?tab=T&cursor=7');
    const inbox = listener();
    const leaveInbox = joinWaLive('inbox', inbox.onChange, inbox.onStatus);
    await booted();
    expect(FakeEventSource.all.map(streamUrl)).toEqual(['/api/groups/live?tab=T&cursor=7', '/api/inbox/live?tab=T&cursor=7']);
    // La misma pestaña manda siempre el mismo id: el servidor reemplaza su conexión anterior.
    expect(FakeEventSource.all[0].url.match(/tab=([^&]+)/)![1]).toBe(FakeEventSource.all[1].url.match(/tab=([^&]+)/)![1]);
    leaveList();
    expect(FakeEventSource.all[0].closed).toBe(false);
    leaveChat();
    expect(FakeEventSource.all[0].closed).toBe(true);
    leaveInbox();
  });

  it('sin stream habilitado (lo dice el servidor) no lo intenta nunca: consulta cada 3 s', async () => {
    pollReply = { events: [], cursor: 7, stream: false };
    const a = listener();
    const leave = joinWaLive('inbox', a.onChange, a.onStatus);
    await booted();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeEventSource.all).toHaveLength(0);
    expect(a.status.at(-1)).toBe('polling');
    // Al arrancar pide releer todo (lo que pasó desde que se cargó la página).
    expect(a.got).toEqual([null]);
    pollReply = { events: [{ id: 8, chatId: 'c9', kind: 'msg' }], cursor: 8, stream: false };
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS + 50);
    expect(urlOf(fetchMock.mock.calls.length - 1)).toBe('/api/inbox/live?cursor=7');
    expect(a.got.at(-1)).toEqual([{ chatId: 'c9', kind: 'msg' }]);
    // Ni a los 10 minutos prueba abrir un stream.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(FakeEventSource.all).toHaveLength(0);
    leave();
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('si la primera consulta falla, reintenta con espera creciente y conecta cuando vuelve la red', async () => {
    pollFails = 2;
    const a = listener();
    const leave = joinWaLive('groups', a.onChange, a.onStatus);
    await booted();
    expect(a.status.at(-1)).toBe('offline');
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(FakeEventSource.all).toHaveLength(1);
    leave();
  });

  it('al conectar pide releer todo; después avisa chat por chat y dice si mueve la lista', async () => {
    const a = listener();
    const leave = joinWaLive('inbox', a.onChange, a.onStatus);
    await booted();
    const es = FakeEventSource.all[0];
    expect(a.got).toEqual([]);
    es.emit('ready', { cursor: 10 });
    expect(a.got).toEqual([null]);
    expect(a.status.at(-1)).toBe('live');
    es.emit('events', { events: [{ id: 11, chatId: 'c1', kind: 'msg' }, { id: 12, chatId: 'c1', kind: 'chat' }, { id: 13, chatId: 'c2', kind: 'msg' }], cursor: 13 });
    expect(a.got.at(-1)).toEqual([
      { chatId: 'c1', kind: 'chat' },
      { chatId: 'c2', kind: 'msg' },
    ]);
    // Un aviso sin chat (hueco grande) pide releer todo.
    es.emit('events', { events: [{ id: 14, chatId: '' }], cursor: 14 });
    expect(a.got.at(-1)).toBeNull();
    leave();
  });

  it('el cierre ordenado de cada 4 minutos sigue desde su cursor SIN releer todo; un corte de verdad sí relee', async () => {
    const a = listener();
    const leave = joinWaLive('groups', a.onChange, a.onStatus);
    await booted();
    const first = FakeEventSource.all[0];
    first.emit('ready', { cursor: 7 });
    first.emit('events', { events: [{ id: 15, chatId: 'c1', kind: 'chat' }], cursor: 15 });
    const before = a.got.length;
    // El servidor cierra y dice hasta dónde mandó.
    first.emit('bye', { cursor: 15 });
    expect(first.closed).toBe(true);
    expect(FakeEventSource.all).toHaveLength(2);
    expect(streamUrl(FakeEventSource.all[1])).toBe('/api/groups/live?tab=T&cursor=15');
    FakeEventSource.all[1].emit('ready', { cursor: 15 });
    // Nada de releer: no hubo hueco. Y nunca pasó por "desconectado".
    expect(a.got.length).toBe(before);
    expect(a.status.filter((s) => s === 'live')).toHaveLength(1);
    // Oculta más de un minuto: se cierra; al volver reabre desde su cursor y ahí sí pide releer.
    setVisibility('hidden');
    const second = FakeEventSource.all[1];
    for (let left = HIDDEN_CLOSE_MS + 2000; left > 0; left -= 10_000) {
      vi.advanceTimersByTime(Math.min(10_000, left));
      if (!second.closed) second.emit('ping');
    }
    expect(second.closed).toBe(true);
    setVisibility('visible');
    expect(streamUrl(FakeEventSource.all[2])).toBe('/api/groups/live?tab=T&cursor=15');
    FakeEventSource.all[2].emit('ready', { cursor: 15 });
    expect(a.got.length).toBe(before + 1);
    expect(a.got.at(-1)).toBeNull();
    leave();
  });

  it('si el stream no anda en este navegador, cae a la consulta; perdió el acceso: ni reconecta ni consulta', async () => {
    const a = listener();
    const leave = joinWaLive('inbox', a.onChange, a.onStatus);
    await booted();
    FakeEventSource.all[0].refuse();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.status.at(-1)).toBe('polling');
    expect(urlOf(fetchMock.mock.calls.length - 1)).toBe('/api/inbox/live?cursor=7');
    leave();

    const b = listener();
    const leaveB = joinWaLive('groups', b.onChange, b.onStatus);
    await booted();
    const es = FakeEventSource.all.at(-1)!;
    es.emit('ready', { cursor: 3 });
    es.emit('bye', { reason: 'revoked', cursor: 3 });
    expect(es.closed).toBe(true);
    expect(b.status.at(-1)).toBe('offline');
    const streams = FakeEventSource.all.length;
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeEventSource.all).toHaveLength(streams);
    expect(fetchMock.mock.calls.length).toBe(calls);
    leaveB();
  });
});

describe('el ritmo de las relecturas', () => {
  it('coalesced: nunca dos a la vez; varios pedidos durante una corren una sola más al terminar', async () => {
    let running = 0;
    let max = 0;
    let runs = 0;
    const go = coalesced(async () => {
      running++;
      max = Math.max(max, running);
      runs++;
      await new Promise((r) => setTimeout(r, 30));
      running--;
    });
    go();
    go();
    go();
    await vi.advanceTimersByTimeAsync(200);
    expect(max).toBe(1);
    expect(runs).toBe(2);
  });

  /**
   * Una tanda de 200 avisos en 10 s (20 por segundo: un grupo activo con tildes, reacciones y "escribiendo") contra
   * una lista que tarda 300 ms en responder. `antes` reproduce lo que hacía la pantalla: juntar 80 ms y pedir la
   * lista cortando la que estuviera en curso.
   */
  async function burst(mode: 'antes' | 'ahora', kinds: Array<'chat' | 'msg'>) {
    let started = 0;
    let finished = 0;
    let aborted = 0;
    let inFlight: { cancelled: boolean } | null = null;
    const load = () => {
      started++;
      if (mode === 'antes' && inFlight) {
        inFlight.cancelled = true;
        aborted++;
      }
      const mine = { cancelled: false };
      inFlight = mine;
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          if (!mine.cancelled) finished++;
          if (inFlight === mine) inFlight = null;
          resolve();
        }, 300),
      );
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const old = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void load();
      }, 80);
    };
    const now = paced(load, LIST_FLOOR_MS, GATHER_MS);
    let lastFinishedDuring = 0;
    for (let i = 0; i < 200; i++) {
      const kind = kinds[i % kinds.length];
      if (mode === 'antes') old();
      else if (kind === 'chat') now();
      await vi.advanceTimersByTimeAsync(50);
      lastFinishedDuring = finished;
    }
    await vi.advanceTimersByTimeAsync(3000);
    return { started, finished, aborted, finishedDuring: lastFinishedDuring };
  }

  it('M1: bajo una tanda de 200 avisos la lista se pide a lo sumo una vez por segundo y ninguna carga se corta', async () => {
    const antes = await burst('antes', ['chat']);
    const ahora = await burst('ahora', ['chat']);
    // Antes: una relectura cada ~100 ms (unas 10 por segundo), cada una cortando la anterior: la lista no se
    // actualizaba hasta que la tanda terminaba.
    expect(antes.started).toBeGreaterThan(90);
    expect(antes.aborted).toBeGreaterThan(85);
    expect(antes.finishedDuring).toBe(0);
    // Ahora: una por segundo, todas terminan, y la lista se va actualizando durante la tanda.
    expect(ahora.started).toBeLessThanOrEqual(11);
    expect(ahora.started).toBeGreaterThanOrEqual(9);
    expect(ahora.aborted).toBe(0);
    expect(ahora.finished).toBe(ahora.started);
    expect(ahora.finishedDuring).toBeGreaterThanOrEqual(8);
    // Y si 9 de cada 10 avisos son de adentro de un chat (tildes, reacciones), la lista ni se entera de esos.
    const mezcla = await burst('ahora', ['chat', 'msg', 'msg', 'msg', 'msg', 'msg', 'msg', 'msg', 'msg', 'msg']);
    expect(mezcla.started).toBeLessThanOrEqual(11);
    const soloAdentro = await burst('ahora', ['msg']);
    expect(soloAdentro.started).toBe(0);
    // eslint-disable-next-line no-console
    console.error(`[M1] 200 avisos en 10 s, lista de 300 ms · antes: ${antes.started} pedidos (${(antes.started / 10).toFixed(1)}/s), ${antes.aborted} cortados, ${antes.finishedDuring} terminados durante la tanda · ahora: ${ahora.started} pedidos (${(ahora.started / 10).toFixed(1)}/s), ${ahora.aborted} cortados, ${ahora.finishedDuring} terminados durante la tanda · con 9 de 10 avisos de adentro del chat: ${mezcla.started} · solo de adentro: ${soloAdentro.started}`);
  });
});
