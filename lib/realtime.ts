/**
 * Tiempo real sin websockets (servidor). Vercel no mantiene sockets, pero con
 * Fluid una función puede quedar abierta unos minutos: el stream SSE consulta
 * un feed de eventos con cursor (una tabla con id autoincremental) cada poco
 * y manda lo nuevo. A los pocos minutos cierra y el navegador se reconecta
 * solo (EventSource manda Last-Event-ID, así no se pierde nada). El fallback
 * es el mismo feed por polling corto (ver lib/realtime-client.ts).
 *
 * Reutilizable: cada app pasa su `poll(cursor)` con su propio chequeo de
 * acceso. Server-only.
 */

export interface RealtimeBatch<E> {
  events: E[];
  /** Cursor después de estos eventos (el último id visto). */
  cursor: number;
}

export interface SseOptions<E> {
  /** Cursor desde el que se manda (Last-Event-ID o ?cursor=). */
  cursor: number;
  poll: (cursor: number) => Promise<RealtimeBatch<E>>;
  /** Cada cuánto se consulta el feed. */
  intervalMs?: number;
  /** Cuánto queda abierta la conexión antes de pedir que el navegador se reconecte. */
  maxMs?: number;
  /** Comentario `: ping` para que proxies no corten la conexión ociosa. */
  heartbeatMs?: number;
  /** Cada cuánto corre `tick` (p. ej. marcar presencia). */
  tickMs?: number;
  tick?: () => Promise<void>;
  signal?: AbortSignal;
}

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Nginx y algunos proxies guardan la respuesta si no se les pide lo contrario.
  'X-Accel-Buffering': 'no',
} as const;

/** Cursor del request: header Last-Event-ID (reconexión) o ?cursor=. */
export function requestCursor(req: Request): number {
  const header = req.headers.get('last-event-id');
  const fromQuery = new URL(req.url).searchParams.get('cursor');
  const n = Number(header ?? fromQuery ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Arma un frame SSE. */
export function sseFrame(event: string, data: unknown, id?: number): string {
  return `${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Response de un stream SSE. Frames: `ready` (cursor inicial), `events`
 * (lotes, con id = cursor), `bye` (antes de cerrar a los maxMs). El primer
 * frame lleva `retry:` para que la reconexión sea rápida.
 */
export function sseResponse<E>(opts: SseOptions<E>): Response {
  const interval = Math.max(250, opts.intervalMs ?? 3000);
  const maxMs = Math.max(5_000, opts.maxMs ?? 240_000);
  const heartbeat = Math.max(5_000, opts.heartbeatMs ?? 20_000);
  const tickMs = opts.tickMs ?? 60_000;
  const encoder = new TextEncoder();
  let cursor = opts.cursor;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now();
      let lastWrite = Date.now();
      let lastTick = 0;
      const write = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(s));
          lastWrite = Date.now();
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* ya cerrado */
        }
      };
      opts.signal?.addEventListener('abort', close);
      write(`retry: 1500\n${sseFrame('ready', { cursor }, cursor || undefined)}`);
      while (!closed && Date.now() - started < maxMs) {
        try {
          if (opts.tick && Date.now() - lastTick >= tickMs) {
            lastTick = Date.now();
            await opts.tick();
          }
          const batch = await opts.poll(cursor);
          if (batch.events.length > 0 || batch.cursor !== cursor) {
            cursor = batch.cursor;
            write(sseFrame('events', batch, cursor));
          } else if (Date.now() - lastWrite >= heartbeat) {
            write(sseFrame('ping', {}));
          }
        } catch {
          // Un error de la base no tumba la conexión: se reintenta en el próximo ciclo.
        }
        await new Promise((r) => setTimeout(r, interval));
      }
      write(sseFrame('bye', { cursor }, cursor || undefined));
      close();
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

// ---------- Feed compartido por instancia ----------

/**
 * Un solo lector del feed por instancia del servidor, sin importar cuántas
 * pestañas haya: consulta lo nuevo (`id > cursor`, por la clave primaria)
 * cada `intervalMs` mientras haya alguien conectado y lo reparte a todas las
 * conexiones SSE de esta instancia. Cada conexión filtra por su cuenta (con
 * su acceso cacheado). Vive en globalThis para sobrevivir a recargas del
 * módulo en desarrollo.
 */
export interface SharedFeed<E extends { id: number }> {
  subscribe(fn: (events: E[]) => void | Promise<void>): () => void;
  /** Último id visto (0 hasta la primera lectura). */
  cursor(): number;
  /** Conexiones suscriptas ahora. */
  size(): number;
}

interface FeedState<E> {
  listeners: Set<(events: E[]) => void | Promise<void>>;
  cursor: number;
  started: boolean;
}

const FEEDS_KEY = Symbol.for('zerosoft.realtime.feeds');

export function sharedFeed<E extends { id: number }>(
  key: string,
  opts: { start: () => Promise<number>; fetchSince: (cursor: number) => Promise<E[]>; intervalMs?: number },
): SharedFeed<E> {
  const g = globalThis as unknown as Record<symbol, Map<string, FeedState<E>>>;
  g[FEEDS_KEY] ??= new Map();
  let state = g[FEEDS_KEY].get(key);
  if (!state) {
    state = { listeners: new Set(), cursor: 0, started: false };
    g[FEEDS_KEY].set(key, state);
  }
  const s = state;
  const interval = Math.max(200, opts.intervalMs ?? 700);
  const loop = async () => {
    if (!s.listeners.size) {
      s.started = false;
      return;
    }
    try {
      if (!s.cursor) s.cursor = await opts.start();
      const events = await opts.fetchSince(s.cursor);
      if (events.length) {
        s.cursor = events[events.length - 1].id;
        await Promise.all([...s.listeners].map((fn) => Promise.resolve(fn(events)).catch(() => undefined)));
      }
    } catch {
      // Un error de la base no corta el feed: se reintenta en la próxima vuelta.
    }
    if (s.listeners.size) setTimeout(() => void loop(), interval);
    else s.started = false;
  };
  return {
    subscribe(fn) {
      s.listeners.add(fn);
      if (!s.started) {
        s.started = true;
        setTimeout(() => void loop(), 0);
      }
      return () => {
        s.listeners.delete(fn);
      };
    },
    cursor: () => s.cursor,
    size: () => s.listeners.size,
  };
}

export interface SseLiveOptions<E> {
  /** Cursor del cliente (Last-Event-ID o ?cursor=). */
  cursor: number;
  /** Lo que el cliente se perdió antes de engancharse (una sola consulta); `gap` pide recargar. */
  backlog: (cursor: number) => Promise<{ events: E[]; cursor: number; gap?: boolean }>;
  /** Suscripción al feed compartido; `push` recibe lo de esta conexión ya filtrado. */
  subscribe: (push: (batch: { events: E[]; cursor: number }) => void) => () => void;
  maxMs?: number;
  heartbeatMs?: number;
  tickMs?: number;
  tick?: () => Promise<void>;
  signal?: AbortSignal;
}

/**
 * SSE sobre un feed compartido: manda `ready`, el atraso (o `reset` si el
 * hueco es grande y conviene recargar) y después lo que llega en vivo. Ping
 * cada `heartbeatMs` y cierre a los `maxMs` (el navegador reconecta solo).
 */
export function sseLiveResponse<E extends { id?: number }>(opts: SseLiveOptions<E>): Response {
  const maxMs = Math.max(5_000, opts.maxMs ?? 240_000);
  const heartbeat = Math.max(2_000, opts.heartbeatMs ?? 15_000);
  const tickMs = opts.tickMs ?? 60_000;
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const stopAll = () => {
    unsubscribe?.();
    for (const t of timers) clearTimeout(t);
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          closed = true;
          stopAll();
        }
      };
      const close = () => {
        if (closed) return;
        write(sseFrame('bye', {}));
        closed = true;
        stopAll();
        try {
          controller.close();
        } catch {
          /* ya cerrado */
        }
      };
      opts.signal?.addEventListener('abort', close);
      let cursor = opts.cursor;
      // Lo que llega mientras se lee el atraso se guarda y sale después, en orden.
      const pending: Array<{ events: E[]; cursor: number }> = [];
      let live = false;
      const send = (batch: { events: E[]; cursor: number }) => {
        const events = batch.events.filter((e) => typeof e.id !== 'number' || e.id > cursor);
        cursor = Math.max(cursor, batch.cursor);
        if (events.length) write(sseFrame('events', { events, cursor }, cursor));
      };
      unsubscribe = opts.subscribe((batch) => {
        if (live) send(batch);
        else pending.push(batch);
      });
      write(`retry: 1500\n${sseFrame('ready', { cursor }, cursor || undefined)}`);
      try {
        const back = await opts.backlog(cursor);
        if (back.gap) {
          cursor = Math.max(cursor, back.cursor);
          write(sseFrame('reset', { cursor }, cursor));
        } else send(back);
      } catch {
        /* sin atraso: sigue en vivo */
      }
      live = true;
      for (const b of pending.splice(0)) send(b);
      const ping = () => {
        if (closed) return;
        write(sseFrame('ping', {}));
        timers.push(setTimeout(ping, heartbeat));
      };
      timers.push(setTimeout(ping, heartbeat));
      if (opts.tick) {
        const tick = () => {
          if (closed) return;
          void opts.tick!().catch(() => undefined);
          timers.push(setTimeout(tick, tickMs));
        };
        tick();
      }
      timers.push(setTimeout(close, maxMs));
    },
    cancel() {
      closed = true;
      stopAll();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
