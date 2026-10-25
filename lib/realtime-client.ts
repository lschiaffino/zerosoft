'use client';

/**
 * Tiempo real sin websockets (navegador). Abre un EventSource contra el
 * stream SSE (lib/realtime.ts) y:
 *  - vigila la conexión: si no llega nada (ni el ping) en 2× el heartbeat,
 *    la cierra y reconecta;
 *  - si SSE no conecta o se cae seguido, pasa a polling corto contra el
 *    mismo feed y cada tanto vuelve a probar SSE (backoff hasta 5 min);
 *  - avisa cuándo reconectó (`onConnect`) o cuándo el servidor pide
 *    recargar el estado por un hueco grande (`onReset`), para que la app
 *    rehaga su estado solo en esos casos.
 * Con la pestaña oculta el polling se espacia. Reutilizable por cualquier app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type RealtimeMode = 'sse' | 'poll';
export type RealtimeStatus = 'connecting' | 'live' | 'polling' | 'offline';

export interface RealtimeOptions<E> {
  /** URL del stream SSE (sin cursor: se agrega). */
  streamUrl: string;
  /** URL del feed por polling: responde { events, cursor }. */
  pollUrl: string;
  /** Cursor inicial (lo trae la página del servidor). */
  cursor: number;
  /** 'poll' fuerza el polling (tests, proxies que cortan SSE). */
  mode?: RealtimeMode;
  onEvents: (events: E[]) => void;
  onStatus?: (status: RealtimeStatus) => void;
  /** Reconectó después de una caída (no en la primera conexión): conviene refrescar el estado. */
  onConnect?: () => void;
  /** El servidor dice que el hueco es grande: rehacer el estado. */
  onReset?: () => void;
  /** Polling con la pestaña visible / oculta. */
  pollMs?: number;
  hiddenPollMs?: number;
  /** Cada cuánto manda ping el servidor (el watchdog espera el doble). */
  heartbeatMs?: number;
}

const SSE_RETRY_MIN = 30_000;
const SSE_RETRY_MAX = 5 * 60_000;

export class RealtimeClient<E> {
  private cursor: number;
  private es: EventSource | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private sseRetry: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private failures = 0;
  private mode: RealtimeMode;
  private forced: boolean;
  private status: RealtimeStatus = 'connecting';
  private lastFrame = 0;
  private connectedOnce = false;
  private sseBackoff = SSE_RETRY_MIN;

  constructor(private opts: RealtimeOptions<E>) {
    this.cursor = opts.cursor;
    this.mode = opts.mode ?? 'sse';
    this.forced = opts.mode === 'poll';
  }

  start() {
    this.stopped = false;
    if (this.mode === 'sse' && typeof EventSource !== 'undefined') this.openStream();
    else this.schedulePoll(0);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }

  stop() {
    this.stopped = true;
    this.closeStream();
    if (this.timer) clearTimeout(this.timer);
    if (this.sseRetry) clearTimeout(this.sseRetry);
    this.timer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /** Pide lo nuevo ya (p. ej. después de mandar un mensaje en modo polling). */
  nudge() {
    if (this.mode === 'poll' && !this.stopped) this.schedulePoll(0);
  }

  get currentCursor() {
    return this.cursor;
  }

  get isLive() {
    return this.status === 'live';
  }

  private setStatus(s: RealtimeStatus) {
    if (s === this.status) return;
    this.status = s;
    this.opts.onStatus?.(s);
  }

  private deliver(batch: { events?: E[]; cursor?: number }) {
    if (typeof batch.cursor === 'number' && batch.cursor > this.cursor) this.cursor = batch.cursor;
    if (batch.events?.length) this.opts.onEvents(batch.events);
  }

  private closeStream() {
    this.es?.close();
    this.es = null;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  private openStream() {
    this.closeStream();
    const sep = this.opts.streamUrl.includes('?') ? '&' : '?';
    const es = new EventSource(`${this.opts.streamUrl}${sep}cursor=${this.cursor}`);
    this.es = es;
    this.lastFrame = Date.now();
    const seen = () => {
      this.lastFrame = Date.now();
    };
    es.addEventListener('ready', () => {
      seen();
      this.failures = 0;
      this.sseBackoff = SSE_RETRY_MIN;
      if (this.mode === 'poll') {
        this.mode = 'sse';
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
      }
      this.setStatus('live');
      if (this.connectedOnce) this.opts.onConnect?.();
      this.connectedOnce = true;
    });
    es.addEventListener('ping', seen);
    es.addEventListener('events', (ev) => {
      seen();
      try {
        this.deliver(JSON.parse((ev as MessageEvent).data));
      } catch {
        /* frame roto: se ignora */
      }
    });
    es.addEventListener('reset', (ev) => {
      seen();
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { cursor?: number };
        if (typeof data.cursor === 'number') this.cursor = Math.max(this.cursor, data.cursor);
      } catch {
        /* sin cursor */
      }
      this.opts.onReset?.();
    });
    es.addEventListener('bye', () => {
      seen();
      // El servidor cierra a los pocos minutos: EventSource reconecta solo con Last-Event-ID.
      this.setStatus('connecting');
    });
    es.onerror = () => {
      this.failures += 1;
      if (es.readyState === EventSource.CLOSED || this.failures >= 3) {
        this.fallbackToPoll();
      } else {
        this.setStatus('connecting');
      }
    };
    // Watchdog: sin frames (ni ping) en 2× heartbeat, la conexión está muerta aunque no lo diga.
    const limit = 2 * (this.opts.heartbeatMs ?? 15_000);
    this.watchdog = setInterval(() => {
      if (this.stopped || this.es !== es) return;
      if (Date.now() - this.lastFrame > limit) {
        this.failures += 1;
        if (this.failures >= 3) this.fallbackToPoll();
        else this.openStream();
      }
    }, Math.max(1000, limit / 4));
  }

  private fallbackToPoll() {
    this.closeStream();
    // Sin SSE (proxy, error del servidor): polling corto, y más tarde se vuelve a probar SSE.
    this.mode = 'poll';
    this.schedulePoll(0);
    if (!this.forced && typeof EventSource !== 'undefined') {
      if (this.sseRetry) clearTimeout(this.sseRetry);
      const wait = this.sseBackoff;
      this.sseBackoff = Math.min(SSE_RETRY_MAX, this.sseBackoff * 2);
      this.sseRetry = setTimeout(() => {
        if (this.stopped) return;
        this.failures = 0;
        this.openStream();
      }, wait);
    }
  }

  private onVisibility = () => {
    if (this.mode === 'poll' && document.visibilityState === 'visible') this.schedulePoll(0);
  };

  private schedulePoll(delay: number) {
    if (this.stopped || this.mode !== 'poll') return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.pollOnce(), delay);
  }

  private async pollOnce() {
    if (this.stopped || this.mode !== 'poll') return;
    try {
      const sep = this.opts.pollUrl.includes('?') ? '&' : '?';
      const res = await fetch(`${this.opts.pollUrl}${sep}cursor=${this.cursor}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const wasOffline = this.status === 'offline';
      this.deliver(await res.json());
      this.failures = 0;
      this.setStatus('polling');
      if (wasOffline) this.opts.onConnect?.();
    } catch {
      this.failures += 1;
      this.setStatus('offline');
    }
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const base = hidden ? (this.opts.hiddenPollMs ?? 15_000) : (this.opts.pollMs ?? 2_500);
    // Backoff si falla seguido (hasta 30 s).
    this.schedulePoll(Math.min(30_000, base * Math.max(1, this.failures)));
  }
}

/** Hook: conecta mientras el componente está montado. Los callbacks pueden cambiar sin reconectar. */
export function useRealtime<E>(
  opts: Omit<RealtimeOptions<E>, 'onEvents' | 'onStatus' | 'onConnect' | 'onReset'> & {
    onEvents: (events: E[]) => void;
    onConnect?: () => void;
    onReset?: () => void;
    enabled?: boolean;
  },
) {
  const handlers = useRef(opts);
  handlers.current = opts;
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const clientRef = useRef<RealtimeClient<E> | null>(null);
  const { streamUrl, pollUrl, cursor, mode, pollMs, hiddenPollMs, heartbeatMs, enabled = true } = opts;
  useEffect(() => {
    if (!enabled) return;
    const client = new RealtimeClient<E>({
      streamUrl,
      pollUrl,
      cursor,
      mode,
      pollMs,
      hiddenPollMs,
      heartbeatMs,
      onEvents: (events) => handlers.current.onEvents(events),
      onConnect: () => handlers.current.onConnect?.(),
      onReset: () => handlers.current.onReset?.(),
      onStatus: setStatus,
    });
    clientRef.current = client;
    client.start();
    return () => {
      client.stop();
      clientRef.current = null;
    };
    // El cursor inicial solo cuenta al conectar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, pollUrl, mode, enabled]);
  // Estable: los que lo usan (fetch de la app) no se re-crean en cada render.
  const nudge = useCallback(() => clientRef.current?.nudge(), []);
  return { status, nudge };
}
