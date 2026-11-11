/**
 * Inbox y Lines: aviso en vivo de los chats, barato en lecturas.
 *
 * Los triggers de lib/schema/wa-live-triggers.ts anotan en wa_live_events cada
 * cambio de un chat que mueve la lista (un mensaje nuevo, archivar desde el
 * teléfono, leído, fijar…) y lo que cambia en un mensaje (tildes, reacciones,
 * ediciones), escriba quien escriba (webhook, cron, otra pestaña). Solo ids:
 * nada del contenido. La pantalla relee por sus rutas de siempre, con su
 * acceso.
 *
 * Cómo llega a la pantalla (liveStream): una conexión SSE por pestaña visible.
 * En el servidor, las conexiones de un mismo dueño (la persona en Inbox, el
 * workspace en Lines) comparten un lector que consulta solo lo suyo y desde su
 * cursor, por el índice (app, scope_id, id): sin cambios la consulta no lee
 * filas. Consulta cada LIVE_HOT_MS mientras hay movimiento y cada LIVE_IDLE_MS
 * con todo quieto; y cuando quien escribe está en esta misma instancia (el
 * webhook, un envío) avisa con pokeLive() y se lee en el acto, sin esperar la
 * vuelta. Sin nadie conectado no se consulta nada.
 *
 * No hay un lector de todo el feed: leería los avisos de todos los workspaces
 * (lo que se sacó en d0c64e19). Si SSE no anda, la pantalla cae al polling de
 * livePoll (la misma consulta, por pedido). Server-only.
 */
import { getDb } from './db';
import { sseLiveResponse } from './realtime';

/** Avisos por consulta: más que esto es un hueco grande y la pantalla relee todo. */
const PAGE = 200;

export type LiveApp = 'inbox' | 'lines';

export interface LiveRaw {
  id: number;
  chat_id: string;
  number_id: string;
}

export interface LiveEvent {
  id: number;
  /** '' = releer toda la lista. */
  chatId: string;
}

/** Quién mira: Inbox (la persona) o Lines (el workspace, con las líneas que ve; null = todas). */
export type LiveViewer = { app: 'inbox'; owner: string } | { app: 'lines'; ws: string; numbers: Set<string> | null };

function scopeOf(viewer: LiveViewer): [LiveApp, string] {
  return viewer.app === 'inbox' ? ['inbox', viewer.owner] : ['lines', viewer.ws];
}

/** El último aviso de este dueño (una fila por el índice). */
export async function latestLiveId(viewer: LiveViewer): Promise<number> {
  const [app, scope] = scopeOf(viewer);
  const row = (await getDb().prepare('SELECT MAX(id) AS id FROM wa_live_events WHERE app = ? AND scope_id = ?').get(app, scope)) as { id: number | null } | undefined;
  return Number(row?.id ?? 0);
}

/** Lo nuevo de este dueño desde `cursor` (lee solo esas filas). */
export async function fetchLive(viewer: LiveViewer, cursor: number, limit = PAGE): Promise<LiveRaw[]> {
  const [app, scope] = scopeOf(viewer);
  const rows = (await getDb()
    .prepare('SELECT id, chat_id, number_id FROM wa_live_events WHERE app = ? AND scope_id = ? AND id > ? ORDER BY id LIMIT ?')
    .all(app, scope, cursor, limit)) as LiveRaw[];
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

/** Pura: lo de un lote que ve esta persona, una vez por chat (el último aviso). */
export function liveBatch(rows: LiveRaw[], viewer: LiveViewer): LiveEvent[] {
  const last = new Map<string, number>();
  for (const r of rows) {
    if (viewer.app === 'lines' && viewer.numbers && !viewer.numbers.has(r.number_id)) continue;
    last.set(r.chat_id, r.id);
  }
  return [...last.entries()].map(([chatId, id]) => ({ id, chatId }));
}

/** La consulta de la pantalla: lo nuevo desde `cursor`; sin cursor, solo el cursor actual. */
export async function livePoll(
  viewer: LiveViewer,
  cursor: number,
  /** Lines: las líneas que ve la persona, pedidas solo si hay avisos (null = todas). */
  numbers?: () => Promise<Set<string> | null>,
): Promise<{ events: LiveEvent[]; cursor: number }> {
  if (cursor <= 0) return { events: [], cursor: await latestLiveId(viewer) };
  const rows = await fetchLive(viewer, cursor);
  if (!rows.length) return { events: [], cursor };
  const next = rows[rows.length - 1].id;
  // Mucho atraso: un aviso sin chat pide releer la lista entera.
  if (rows.length >= PAGE) return { events: [{ id: next, chatId: '' }], cursor: next };
  const v = viewer.app === 'lines' && numbers ? { ...viewer, numbers: await numbers() } : viewer;
  return { events: liveBatch(rows, v), cursor: next };
}

/** Limpia el feed: lo de más de una hora ya no sirve (por el índice de created_at: lee solo lo que borra). */
export async function pruneLiveEvents(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
  const res = await getDb().prepare('DELETE FROM wa_live_events WHERE created_at < ?').run(before);
  return res.changes;
}

// ---------- Stream ----------

/** Cada cuánto consulta el lector de un dueño con movimiento reciente, y con todo quieto. */
export const LIVE_HOT_MS = 400;
export const LIVE_IDLE_MS = 1000;
/** Cuánto dura "con movimiento" después del último aviso. */
const LIVE_HOT_FOR_MS = 60_000;
export const LIVE_MAX_MS = 240_000;
/** Conexiones abiertas por persona y app en esta instancia (una por pestaña visible). */
export const LIVE_MAX_PER_PERSON = 6;
/** Cada cuánto se revalida el acceso de una conexión abierta. */
const LIVE_CHECK_MS = 60_000;

type Listener = (rows: LiveRaw[]) => void;

interface Hub {
  app: LiveApp;
  scope: string;
  listeners: Set<Listener>;
  cursor: number;
  /** La lectura del cursor inicial (una sola, al abrirse el lector). */
  ready: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  again: boolean;
  hotUntil: number;
}

// En globalThis: el webhook y el stream pueden cargar este módulo en bundles distintos de la misma instancia.
const HUBS_KEY = Symbol.for('zerosoft.wa-live.hubs');
function hubs(): Map<string, Hub> {
  const g = globalThis as unknown as Record<symbol, Map<string, Hub> | undefined>;
  return (g[HUBS_KEY] ??= new Map());
}
const hubKey = (app: LiveApp, scope: string) => `${app}:${scope}`;

async function turn(h: Hub): Promise<void> {
  h.timer = null;
  if (!h.listeners.size) {
    hubs().delete(hubKey(h.app, h.scope));
    return;
  }
  h.running = true;
  try {
    await h.ready;
    // Solo lo de este dueño: el mismo WHERE que el polling.
    const viewer: LiveViewer = h.app === 'inbox' ? { app: 'inbox', owner: h.scope } : { app: 'lines', ws: h.scope, numbers: null };
    for (;;) {
      const rows = await fetchLive(viewer, h.cursor);
      if (!rows.length) break;
      h.cursor = rows[rows.length - 1].id;
      h.hotUntil = Date.now() + LIVE_HOT_FOR_MS;
      for (const fn of [...h.listeners]) {
        try {
          fn(rows);
        } catch {
          /* una conexión rota no frena a las demás */
        }
      }
      if (rows.length < PAGE) break;
    }
  } catch {
    // Un error de la base no corta el lector: se reintenta en la próxima vuelta.
  }
  h.running = false;
  if (!h.listeners.size) {
    hubs().delete(hubKey(h.app, h.scope));
    return;
  }
  const again = h.again;
  h.again = false;
  h.timer = setTimeout(() => void turn(h), again ? 0 : Date.now() < h.hotUntil ? LIVE_HOT_MS : LIVE_IDLE_MS);
}

/**
 * Se suma al lector de este dueño (lo abre si no había). Devuelve cómo salir y
 * el cursor del lector: lo anterior a ese cursor lo trae la conexión como
 * atraso, lo posterior llega por `fn`.
 */
export function subscribeLive(app: LiveApp, scope: string, fn: Listener): { off: () => void; cursor: () => Promise<number> } {
  const key = hubKey(app, scope);
  let h = hubs().get(key);
  if (!h) {
    const hub: Hub = { app, scope, listeners: new Set(), cursor: 0, ready: null, timer: null, running: false, again: false, hotUntil: Date.now() + LIVE_HOT_FOR_MS };
    const viewer: LiveViewer = app === 'inbox' ? { app: 'inbox', owner: scope } : { app: 'lines', ws: scope, numbers: null };
    hub.ready = latestLiveId(viewer)
      .then((id) => {
        hub.cursor = id;
      })
      .catch(() => undefined);
    hubs().set(key, hub);
    hub.timer = setTimeout(() => void turn(hub), 0);
    h = hub;
  }
  const hub = h;
  hub.listeners.add(fn);
  return {
    off: () => {
      hub.listeners.delete(fn);
    },
    cursor: async () => {
      await hub.ready;
      return hub.cursor;
    },
  };
}

/**
 * Algo de este dueño se acaba de escribir en esta instancia (un webhook, un
 * envío): su lector, si hay alguien conectado acá, lee ya en vez de esperar la
 * vuelta. Sin conexiones no hace nada (ni consulta la base).
 */
export function pokeLive(app: LiveApp, scope: string): void {
  const h = hubs().get(hubKey(app, scope));
  if (!h) return;
  h.hotUntil = Date.now() + LIVE_HOT_FOR_MS;
  if (h.running) h.again = true;
  else {
    if (h.timer) clearTimeout(h.timer);
    h.timer = setTimeout(() => void turn(h), 0);
  }
}

/** Para los tests: lectores abiertos en esta instancia. */
export function liveHubCount(): number {
  return hubs().size;
}

const open = new Map<string, number>();

function takeSlot(key: string): boolean {
  const n = open.get(key) ?? 0;
  if (n >= LIVE_MAX_PER_PERSON) return false;
  open.set(key, n + 1);
  return true;
}

function freeSlot(key: string) {
  const n = (open.get(key) ?? 1) - 1;
  if (n <= 0) open.delete(key);
  else open.set(key, n);
}

/**
 * Stream SSE de los avisos de esta persona. null si ya tiene demasiadas
 * conexiones abiertas. `check` revalida el acceso cada minuto y devuelve quién
 * mira al día (Lines: las líneas que ve); null corta la conexión para siempre
 * (perdió el acceso) y un error la corta para que el navegador reconecte
 * pasando otra vez por la sesión.
 */
export function liveStream(opts: {
  /** Persona y app, para el tope de conexiones. */
  key: string;
  cursor: number;
  signal?: AbortSignal;
  viewer: LiveViewer;
  check: () => Promise<LiveViewer | null>;
  maxMs?: number;
  checkMs?: number;
}): Response | null {
  if (!takeSlot(opts.key)) return null;
  let viewer = opts.viewer;
  const [app, scope] = scopeOf(viewer);
  let close: ((reason?: string) => void) | null = null;
  let sub: ReturnType<typeof subscribeLive> | null = null;
  return sseLiveResponse<LiveEvent>({
    cursor: opts.cursor,
    maxMs: opts.maxMs ?? LIVE_MAX_MS,
    heartbeatMs: 15_000,
    checkMs: opts.checkMs ?? LIVE_CHECK_MS,
    signal: opts.signal,
    check: async () => {
      let v: LiveViewer | null;
      try {
        v = await opts.check();
      } catch {
        // No se pudo revalidar: se corta (sin "revoked") y el navegador vuelve a entrar por la sesión.
        close?.('error');
        return true;
      }
      if (!v || scopeOf(v)[0] !== app || scopeOf(v)[1] !== scope) return false;
      viewer = v;
      return true;
    },
    backlog: async (cursor) => {
      // Primero el cursor del lector (ya suscripto): lo posterior llega por él. El atraso se lee después, así no
      // queda un hueco entre lo que trae el atraso y donde arranca el lector (lo repetido se descarta por id).
      const from = sub ? await sub.cursor() : await latestLiveId(viewer);
      // Sin cursor no hay nada que recuperar: la pantalla acaba de leer sus datos.
      if (cursor <= 0) return { events: [], cursor: from };
      const rows = await fetchLive(viewer, cursor);
      if (rows.length >= PAGE) return { events: [], cursor: rows[rows.length - 1].id, gap: true };
      return { events: liveBatch(rows, viewer), cursor: rows.length ? rows[rows.length - 1].id : cursor };
    },
    subscribe: (push, revoke) => {
      close = revoke;
      sub = subscribeLive(app, scope, (rows) => push({ events: liveBatch(rows, viewer), cursor: rows[rows.length - 1].id }));
      const off = sub.off;
      let freed = false;
      return () => {
        off();
        if (!freed) {
          freed = true;
          freeSlot(opts.key);
        }
      };
    },
  });
}

/**
 * ¿Este pedido quiere (y puede) el stream? EventSource manda
 * `Accept: text/event-stream`. Con WA_LIVE=poll el servidor no sostiene
 * streams (un proxy que los corta, o para apagarlos sin un deploy): responde
 * 204, el navegador no reintenta y la pantalla consulta el aviso por pedido.
 * En modo demo y pruebas, la cookie wa_live=sse lo pide igual (así las pruebas
 * del stream corren con el resto en polling).
 */
export function wantsLiveStream(req: Request): 'stream' | 'off' | 'poll' {
  if (!(req.headers.get('accept') ?? '').includes('text/event-stream')) return 'poll';
  if (process.env.WA_LIVE !== 'poll') return 'stream';
  const optIn = process.env.DEMO_MODE === 'true' && /(?:^|;\s*)wa_live=sse(?:;|$)/.test(req.headers.get('cookie') ?? '');
  return optIn ? 'stream' : 'off';
}
