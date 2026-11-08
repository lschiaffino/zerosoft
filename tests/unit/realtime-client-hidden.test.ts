import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HIDDEN_CLOSE_MS, RealtimeClient } from '@/lib/realtime-client';

// Navegador mínimo: document con visibilidad y un EventSource falso.
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

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.all = [];
  visibility = 'visible';
  docListeners.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
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

/** Avanza el reloj con pings del servidor cada 10 s al stream abierto (el watchdog no salta). */
function advance(ms: number) {
  for (let left = ms; left > 0; left -= 10_000) {
    vi.advanceTimersByTime(Math.min(10_000, left));
    const open = FakeEventSource.all.filter((e) => !e.closed).at(-1);
    open?.emit('ping');
  }
}

function client(onConnect = vi.fn()) {
  const c = new RealtimeClient<{ n: number }>({ streamUrl: '/s', pollUrl: '/p', cursor: 5, onEvents: () => {}, onConnect });
  c.start();
  return c;
}

describe('RealtimeClient con la pestaña oculta', () => {
  it('cierra el stream pasado el umbral y lo reabre desde el cursor al volver, avisando para refrescar', () => {
    const onConnect = vi.fn();
    const c = client(onConnect);
    const first = FakeEventSource.all[0];
    first.emit('ready');
    first.emit('events', { events: [{ n: 1 }], cursor: 9 });
    setVisibility('hidden');
    advance(HIDDEN_CLOSE_MS - 1000);
    expect(first.closed).toBe(false);
    advance(2000);
    expect(first.closed).toBe(true);
    expect(FakeEventSource.all).toHaveLength(1);
    setVisibility('visible');
    expect(FakeEventSource.all).toHaveLength(2);
    expect(FakeEventSource.all[1].url).toBe('/s?cursor=9');
    FakeEventSource.all[1].emit('ready');
    expect(onConnect).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it('un cambio de pestaña corto no corta el stream', () => {
    const c = client();
    const first = FakeEventSource.all[0];
    first.emit('ready');
    setVisibility('hidden');
    advance(10_000);
    setVisibility('visible');
    advance(HIDDEN_CLOSE_MS * 2);
    expect(first.closed).toBe(false);
    expect(FakeEventSource.all).toHaveLength(1);
    c.stop();
  });

  it('stop() con el stream pausado no deja nada pendiente', () => {
    const c = client();
    FakeEventSource.all[0].emit('ready');
    setVisibility('hidden');
    advance(HIDDEN_CLOSE_MS + 1);
    c.stop();
    setVisibility('visible');
    expect(FakeEventSource.all).toHaveLength(1);
  });
});
