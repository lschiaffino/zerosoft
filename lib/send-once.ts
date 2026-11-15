/**
 * Lines e Inbox: un envío con el mismo clientId (la pantalla reintenta porque
 * no le llegó la respuesta, la cola sin conexión lo vuelve a mandar, o dos
 * pedidos iguales casi a la vez) sale una sola vez a WhatsApp. Lo ya guardado
 * se busca en la base (índice único por chat y clientId). Lo que está saliendo
 * se espera en vez de mandarlo otra vez: en esta instancia, por la promesa en
 * curso; en otra instancia del servidor, por la clave tomada en `send_claims`.
 *
 * La clave de un envío que salió queda tomada (marcada `done`): un pedido que
 * leyó "no está guardado" justo antes de que otra instancia lo guardara no
 * puede tomarla y lee lo guardado. La de un envío que falló se suelta, así el
 * reintento sale. El cron horario borra las de más de un día. Server-only.
 */
import { after as afterResponse } from 'next/server';
import { getDb } from './db';

const inFlight = new Map<string, Promise<unknown>>();

/** Una clave sin terminar tomada hace más que esto es de una instancia que se cayó a mitad del envío: se puede volver a tomar. */
const STALE_MS = 2 * 60_000;
/** Cuánto espera un pedido a que termine el mismo envío en otra instancia antes de leer lo guardado. */
const WAIT_MS = 30_000;
const POLL_MS = 300;
const KEEP_MS = 24 * 3600_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Toma la clave del envío para esta instancia. Si la base no responde, se sigue como antes (solo esta instancia). */
async function claim(key: string): Promise<boolean> {
  const now = Date.now();
  try {
    const r = await getDb()
      .prepare(
        `INSERT INTO send_claims (key, created_at, done) VALUES (?, ?, 0)
         ON CONFLICT(key) DO UPDATE SET created_at = excluded.created_at, done = 0
         WHERE send_claims.done = 0 AND send_claims.created_at < ?`,
      )
      .run(key, now, now - STALE_MS);
    return r.changes > 0;
  } catch (err) {
    console.warn('[send-once] claim failed', (err as Error).message);
    return true;
  }
}

async function finish(key: string, ok: boolean): Promise<void> {
  await getDb()
    .prepare(ok ? 'UPDATE send_claims SET done = 1 WHERE key = ?' : 'DELETE FROM send_claims WHERE key = ?')
    .run(key)
    .catch(() => undefined);
}

/** Espera a que el envío de otra instancia termine (salió, o falló y soltó la clave), o hasta `ms`. */
async function waitOther(key: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await sleep(POLL_MS);
    const row = (await getDb()
      .prepare('SELECT done FROM send_claims WHERE key = ?')
      .get(key)
      .catch(() => undefined)) as { done: number } | undefined;
    if (!row || Number(row.done) === 1) return;
  }
}

export interface OnceOptions<T> {
  /** ¿Salió? Sin esto, salió si `send` no tiró error. Lo que no salió suelta la clave para que el reintento salga. */
  ok?: (result: T) => boolean;
  /** Cuánto esperar al mismo envío en otra instancia (un archivo tarda más). */
  waitMs?: number;
}

/**
 * Corre `send` una sola vez por `key` a la vez: un segundo pedido con la misma
 * clave mientras el primero sigue (en esta instancia o en otra), o después de
 * que salió, espera a que termine y corre `after` (que lee lo guardado) en vez
 * de volver a mandar.
 */
export async function onceInFlight<T>(key: string | null, send: () => Promise<T>, after: () => Promise<T>, opts: OnceOptions<T> = {}): Promise<T> {
  if (!key) return send();
  const running = inFlight.get(key);
  if (running) {
    await running.catch(() => undefined);
    return after();
  }
  const p = (async () => {
    if (!(await claim(key))) {
      await waitOther(key, opts.waitMs ?? WAIT_MS);
      return after();
    }
    let result: T;
    try {
      result = await send();
    } catch (err) {
      await finish(key, false);
      throw err;
    }
    const ok = opts.ok ? opts.ok(result) : true;
    if (!ok) await finish(key, false);
    else {
      // Salió: marcarlo no demora la respuesta (se hace después de responder; sin pedido en curso, ya).
      try {
        afterResponse(() => finish(key, true));
      } catch {
        await finish(key, true);
      }
    }
    return result;
  })();
  inFlight.set(key, p);
  try {
    return await p;
  } finally {
    if (inFlight.get(key) === p) inFlight.delete(key);
  }
}

/** Cron horario: las claves de envíos de hace más de un día. */
export async function pruneSendClaims(): Promise<number> {
  const r = await getDb().prepare('DELETE FROM send_claims WHERE created_at < ?').run(Date.now() - KEEP_MS);
  return r.changes;
}

/** Para los tests. */
export function sendsInFlightOnServer(): number {
  return inFlight.size;
}
