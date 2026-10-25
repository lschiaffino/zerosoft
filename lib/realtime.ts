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
            write(': ping\n\n');
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
