/**
 * Inbox y Lines (navegador): la conexión del aviso en vivo que comparten la
 * lista y el chat abierto (lib/wa-live-client.ts). Una sola por app, releer al
 * conectar y al reconectar, y caer a la consulta si el stream no anda.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HIDDEN_CLOSE_MS } from '@/lib/realtime-client';
import { LIVE_POLL_MS, joinWaLive } from '@/lib/wa-live-client';

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
  /** El servidor rechazó el stream (204 con WA_LIVE=poll, o un proxy): el navegador lo da por cerrado. */
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
let pollReply: { events: Array<{ id: number; chatId: string }>; cursor: number } = { events: [], cursor: 7 };
const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => pollReply }));

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.all = [];
  visibility = 'visible';
  docListeners.clear();
  fetchMock.mockClear();
  pollReply = { events: [], cursor: 7 };
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
  const got: string[][] = [];
  const status: string[] = [];
  return { got, status, onChange: (ids: string[]) => got.push(ids), onStatus: (s: string) => status.push(s) };
}

describe('la conexión compartida', () => {
  it('la lista y el chat abierto usan una sola conexión por app; se cierra cuando sale el último', () => {
    const list = listener();
    const chat = listener();
    const leaveList = joinWaLive('groups', list.onChange, list.onStatus);
    const leaveChat = joinWaLive('groups', chat.onChange, chat.onStatus);
    expect(FakeEventSource.all).toHaveLength(1);
    expect(FakeEventSource.all[0].url).toBe('/api/groups/live?cursor=0');
    // Otra app, otra conexión.
    const inbox = listener();
    const leaveInbox = joinWaLive('inbox', inbox.onChange, inbox.onStatus);
    expect(FakeEventSource.all.map((e) => e.url)).toEqual(['/api/groups/live?cursor=0', '/api/inbox/live?cursor=0']);
    leaveList();
    expect(FakeEventSource.all[0].closed).toBe(false);
    leaveChat();
    expect(FakeEventSource.all[0].closed).toBe(true);
    // Volver a entrar abre una nueva.
    const again = joinWaLive('groups', list.onChange, list.onStatus);
    expect(FakeEventSource.all).toHaveLength(3);
    again();
    leaveInbox();
  });

  it('al conectar por primera vez pide releer todo (lo que pasó desde que se cargó la página), y después avisa chat por chat', () => {
    const a = listener();
    const b = listener();
    const leaveA = joinWaLive('inbox', a.onChange, a.onStatus);
    const leaveB = joinWaLive('inbox', b.onChange, b.onStatus);
    const es = FakeEventSource.all[0];
    expect(a.got).toEqual([]);
    es.emit('ready', { cursor: 10 });
    expect(a.got).toEqual([[]]);
    expect(b.got).toEqual([[]]);
    expect(a.status.at(-1)).toBe('live');
    es.emit('events', { events: [{ id: 11, chatId: 'c1' }, { id: 12, chatId: 'c1' }, { id: 13, chatId: 'c2' }], cursor: 13 });
    expect(a.got.at(-1)).toEqual(['c1', 'c2']);
    expect(b.got.at(-1)).toEqual(['c1', 'c2']);
    // Un aviso sin chat (hueco grande) pide releer todo.
    es.emit('events', { events: [{ id: 14, chatId: '' }], cursor: 14 });
    expect(a.got.at(-1)).toEqual([]);
    es.emit('reset', { cursor: 20 });
    expect(a.got.at(-1)).toEqual([]);
    expect(a.got).toHaveLength(4);
    leaveA();
    leaveB();
  });

  it('oculta más de un minuto se cierra; al volver reabre desde su cursor y pide releer', () => {
    const a = listener();
    const leave = joinWaLive('groups', a.onChange, a.onStatus);
    const first = FakeEventSource.all[0];
    first.emit('ready', { cursor: 10 });
    first.emit('events', { events: [{ id: 15, chatId: 'c1' }], cursor: 15 });
    const before = a.got.length;
    setVisibility('hidden');
    for (let left = HIDDEN_CLOSE_MS + 2000; left > 0; left -= 10_000) {
      vi.advanceTimersByTime(Math.min(10_000, left));
      if (!first.closed) first.emit('ping');
    }
    expect(first.closed).toBe(true);
    expect(a.status.at(-1)).toBe('connecting');
    setVisibility('visible');
    expect(FakeEventSource.all).toHaveLength(2);
    // Desde el último aviso que recibió: el servidor le manda lo que pasó mientras tanto.
    expect(FakeEventSource.all[1].url).toBe('/api/groups/live?cursor=15');
    FakeEventSource.all[1].emit('ready', { cursor: 15 });
    expect(a.got.length).toBe(before + 1);
    expect(a.got.at(-1)).toEqual([]);
    expect(a.status.at(-1)).toBe('live');
    leave();
  });

  it('si el servidor no da stream, cae a la consulta de cada 3 s (y también ahí pide releer al arrancar)', async () => {
    const a = listener();
    const leave = joinWaLive('inbox', a.onChange, a.onStatus);
    FakeEventSource.all[0].refuse();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/inbox/live?cursor=0');
    expect(a.status.at(-1)).toBe('polling');
    expect(a.got).toEqual([[]]);
    // La próxima consulta va con el cursor que devolvió la primera, a los 3 s.
    pollReply = { events: [{ id: 8, chatId: 'c9' }], cursor: 8 };
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS - 100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe('/api/inbox/live?cursor=7');
    expect(a.got.at(-1)).toEqual(['c9']);
    leave();
    // Al salir deja de consultar.
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('perdió el acceso (bye revoked): no reconecta ni consulta', async () => {
    const a = listener();
    const leave = joinWaLive('groups', a.onChange, a.onStatus);
    const es = FakeEventSource.all[0];
    es.emit('ready', { cursor: 3 });
    es.emit('bye', { reason: 'revoked' });
    expect(es.closed).toBe(true);
    expect(a.status.at(-1)).toBe('offline');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeEventSource.all).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    leave();
  });
});
