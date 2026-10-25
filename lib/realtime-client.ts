'use client';

/**
 * Tiempo real sin websockets (navegador). Abre un EventSource contra el
 * stream SSE (lib/realtime.ts) y, si no conecta o se cae varias veces
 * seguidas, pasa a polling corto contra el mismo feed. Con la pestaña oculta
 * el polling se espacia. Reutilizable: cada app pasa sus URLs y qué hacer con
 * los eventos.
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
  /** Polling con la pestaña visible / oculta. */
  pollMs?: number;
  hiddenPollMs?: number;
}

export class RealtimeClient<E> {
  private cursor: number;
  private es: EventSource | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private failures = 0;
  private mode: RealtimeMode;
  private status: RealtimeStatus = 'connecting';

  constructor(private opts: RealtimeOptions<E>) {
    this.cursor = opts.cursor;
    this.mode = opts.mode ?? 'sse';
  }

  start() {
    this.stopped = false;
    if (this.mode === 'sse' && typeof EventSource !== 'undefined') this.openStream();
    else this.schedulePoll(0);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }

  stop() {
    this.stopped = true;
    this.es?.close();
    this.es = null;
    if (this.timer) clearTimeout(this.timer);
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

  private setStatus(s: RealtimeStatus) {
    if (s === this.status) return;
    this.status = s;
    this.opts.onStatus?.(s);
  }

  private deliver(batch: { events?: E[]; cursor?: number }) {
    if (typeof batch.cursor === 'number' && batch.cursor > this.cursor) this.cursor = batch.cursor;
    if (batch.events?.length) this.opts.onEvents(batch.events);
  }

  private openStream() {
    const sep = this.opts.streamUrl.includes('?') ? '&' : '?';
    const es = new EventSource(`${this.opts.streamUrl}${sep}cursor=${this.cursor}`);
    this.es = es;
    es.addEventListener('ready', () => {
      this.failures = 0;
      this.setStatus('live');
    });
    es.addEventListener('events', (ev) => {
      try {
        this.deliver(JSON.parse((ev as MessageEvent).data));
      } catch {
        /* frame roto: se ignora */
      }
    });
    es.addEventListener('bye', () => {
      // El servidor cierra a los pocos minutos: EventSource reconecta solo con Last-Event-ID.
      this.setStatus('connecting');
    });
    es.onerror = () => {
      this.failures += 1;
      if (es.readyState === EventSource.CLOSED || this.failures >= 3) {
        es.close();
        this.es = null;
        // Sin SSE (proxy, error del servidor): polling corto.
        this.mode = 'poll';
        this.schedulePoll(0);
      } else {
        this.setStatus('connecting');
      }
    };
  }

  private onVisibility = () => {
    if (this.mode === 'poll' && document.visibilityState === 'visible') this.schedulePoll(0);
  };

  private schedulePoll(delay: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.pollOnce(), delay);
  }

  private async pollOnce() {
    if (this.stopped) return;
    try {
      const sep = this.opts.pollUrl.includes('?') ? '&' : '?';
      const res = await fetch(`${this.opts.pollUrl}${sep}cursor=${this.cursor}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      this.deliver(await res.json());
      this.failures = 0;
      this.setStatus('polling');
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

/** Hook: conecta mientras el componente está montado. onEvents puede cambiar sin reconectar. */
export function useRealtime<E>(opts: Omit<RealtimeOptions<E>, 'onEvents' | 'onStatus'> & { onEvents: (events: E[]) => void; enabled?: boolean }) {
  const handler = useRef(opts.onEvents);
  handler.current = opts.onEvents;
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const clientRef = useRef<RealtimeClient<E> | null>(null);
  const { streamUrl, pollUrl, cursor, mode, pollMs, hiddenPollMs, enabled = true } = opts;
  useEffect(() => {
    if (!enabled) return;
    const client = new RealtimeClient<E>({
      streamUrl,
      pollUrl,
      cursor,
      mode,
      pollMs,
      hiddenPollMs,
      onEvents: (events) => handler.current(events),
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
