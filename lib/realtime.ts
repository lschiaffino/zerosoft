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
  initialized: boolean;
  /** Lectura del cursor inicial, lanzada al suscribirse (antes de que la conexión lea su atraso). */
  starting: Promise<number> | null;
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
    state = { listeners: new Set(), cursor: 0, initialized: false, starting: null, started: false };
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
      if (!s.initialized) {
        s.cursor = await (s.starting ?? opts.start());
        s.initialized = true;
        s.starting = null;
      }
      const events = await opts.fetchSince(s.cursor);
      if (events.length) {
        s.cursor = events[events.length - 1].id;
        await Promise.all([...s.listeners].map((fn) => Promise.resolve(fn(events)).catch(() => undefined)));
      }
    } catch {
      // Un error de la base no corta el feed: se reintenta en la próxima vuelta.
    }
    if (s.listeners.size) setTimeout(() => void loop(), interval);
    else {
      // Sin nadie conectado se deja de leer; al volver se toma el cursor de nuevo.
      s.started = false;
      s.initialized = false;
    }
  };
  return {
    subscribe(fn) {
      s.listeners.add(fn);
      if (!s.started) {
        s.started = true;
        // El cursor se toma ya, en el momento de la suscripción: lo que pase después
        // llega por el feed y lo de antes, por el atraso de cada conexión.
        if (!s.initialized && !s.starting) s.starting = opts.start();
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
  /**
   * Suscripción al feed compartido; `push` recibe lo de esta conexión ya
   * filtrado y `revoke` corta la conexión (p. ej. la persona perdió el acceso).
   */
  subscribe: (push: (batch: { events: E[]; cursor: number }) => void, revoke: (reason: string) => void) => () => void;
  maxMs?: number;
  heartbeatMs?: number;
  /** Red de seguridad periódica: false corta la conexión con `bye` { reason: 'revoked' }. */
  check?: () => Promise<boolean>;
  checkMs?: number;
  tickMs?: number;
  tick?: () => Promise<void>;
  signal?: AbortSignal;
}

/**
 * SSE sobre un feed compartido: manda `ready` (con el cursor real, después de
 * leer el atraso), el atraso (o `reset` si el hueco es grande) y después lo
 * que llega en vivo. Ping cada `heartbeatMs`, revalidación cada `checkMs` y
 * cierre a los `maxMs` (el navegador reconecta solo). Si se revoca el acceso
 * manda `bye` con `reason: 'revoked'` y el navegador no reconecta.
 */
export function sseLiveResponse<E extends { id?: number }>(opts: SseLiveOptions<E>): Response {
  const maxMs = Math.max(5_000, opts.maxMs ?? 240_000);
  const heartbeat = Math.max(2_000, opts.heartbeatMs ?? 15_000);
  const tickMs = opts.tickMs ?? 60_000;
  const checkMs = Math.max(1_000, opts.checkMs ?? heartbeat);
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
      const close = (reason?: string) => {
        if (closed) return;
        write(sseFrame('bye', reason ? { reason } : {}));
        closed = true;
        stopAll();
        try {
          controller.close();
        } catch {
          /* ya cerrado */
        }
      };
      opts.signal?.addEventListener('abort', () => close());
      let cursor = opts.cursor;
      // Lo que llega mientras se lee el atraso se guarda y sale después, en orden.
      const pending: Array<{ events: E[]; cursor: number }> = [];
      let live = false;
      const send = (batch: { events: E[]; cursor: number }) => {
        if (closed) return;
        const events = batch.events.filter((e) => typeof e.id !== 'number' || e.id > cursor);
        cursor = Math.max(cursor, batch.cursor);
        if (events.length) write(sseFrame('events', { events, cursor }, cursor));
      };
      unsubscribe = opts.subscribe(
        (batch) => {
          if (live) send(batch);
          else pending.push(batch);
        },
        (reason) => close(reason),
      );
      let back: { events: E[]; cursor: number; gap?: boolean } = { events: [], cursor };
      try {
        back = await opts.backlog(cursor);
      } catch {
        /* sin atraso: sigue en vivo */
      }
      if (opts.check && !(await opts.check().catch(() => true))) return close('revoked');
      // El cursor real (hasta dónde llega lo que sigue). Sin id: el id lo llevan los frames de eventos.
      const readyCursor = back.gap ? back.cursor : Math.max(cursor, back.cursor);
      write(`retry: 1500\n${sseFrame('ready', { cursor: readyCursor })}`);
      if (back.gap) {
        cursor = Math.max(cursor, back.cursor);
        write(sseFrame('reset', { cursor }, cursor));
      } else send(back);
      live = true;
      for (const b of pending.splice(0)) send(b);
      const ping = () => {
        if (closed) return;
        write(sseFrame('ping', {}));
        timers.push(setTimeout(ping, heartbeat));
      };
      timers.push(setTimeout(ping, heartbeat));
      if (opts.check) {
        const check = () => {
          if (closed) return;
          void opts.check!()
            .then((ok) => (ok ? timers.push(setTimeout(check, checkMs)) : close('revoked')))
            .catch(() => timers.push(setTimeout(check, checkMs)));
        };
        timers.push(setTimeout(check, checkMs));
      }
      if (opts.tick) {
        const tick = () => {
          if (closed) return;
          void opts.tick!().catch(() => undefined);
          timers.push(setTimeout(tick, tickMs));
        };
        tick();
      }
      timers.push(setTimeout(() => close(), maxMs));
    },
    cancel() {
      closed = true;
      stopAll();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
