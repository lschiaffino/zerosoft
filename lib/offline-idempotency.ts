/**
 * Altas que pueden llegar dos veces (modo sin conexión).
 *
 * Lo que se crea sin red queda en la cola del service worker (public/sw.js)
 * con una clave propia (`x-zs-idempotency-key`, la pone la página en
 * lib/offline-fetch.ts). Si el pedido llegó al servidor pero la respuesta se
 * perdió con la red, la cola lo reenvía: con la clave, la segunda vez se
 * devuelve la respuesta de la primera en vez de crear otra fila.
 *
 * La clave es de cada persona (user_id, key) y de un pedido (método y ruta). Mientras la primera corre, otra
 * con la misma clave recibe 503 con `x-zs-retry: 1` (el worker la deja en la
 * cola y prueba más tarde). Una respuesta de error libera la clave.
 * El cron horario borra las de más de 7 días.
 */
import { NextResponse } from 'next/server';
import { getDb } from './db';

export const IDEMPOTENCY_HEADER = 'x-zs-idempotency-key';
export const REPLAYED_HEADER = 'x-zs-replayed';
export const RETRY_HEADER = 'x-zs-retry';
/** Tope de lo que se guarda de la respuesta (una fila de issue, comentario o contacto). */
const MAX_BODY = 200_000;

export function idempotencyKey(req: Request): string | null {
  const raw = req.headers.get(IDEMPOTENCY_HEADER)?.trim();
  if (!raw || raw.length > 100 || !/^[\w-]+$/.test(raw)) return null;
  return raw;
}

/**
 * Corre `run` una sola vez por (persona, clave). Sin clave en el pedido, corre
 * siempre (los pedidos de siempre no cambian).
 */
export async function withIdempotency(req: Request, userId: string, run: () => Promise<NextResponse>): Promise<NextResponse> {
  const key = idempotencyKey(req);
  if (!key) return run();
  const db = getDb();
  // La clave vale para un pedido (método y ruta): reusarla en otro no devuelve aquella respuesta.
  const scope = `${req.method.toUpperCase()} ${new URL(req.url).pathname}`.slice(0, 300);
  const claim = await db
    .prepare('INSERT OR IGNORE INTO offline_requests (user_id, key, scope) VALUES (?, ?, ?)')
    .run(userId, key, scope);
  if (claim.changes === 0) {
    const prev = (await db
      .prepare('SELECT scope, status, body FROM offline_requests WHERE user_id = ? AND key = ?')
      .get(userId, key)) as { scope: string; status: number | null; body: string | null } | undefined;
    if (prev && prev.scope !== scope) return NextResponse.json({ error: 'idempotency_key_reused' }, { status: 409 });
    if (prev?.status) {
      return new NextResponse(prev.body ?? '', {
        status: prev.status,
        headers: { 'content-type': 'application/json', [REPLAYED_HEADER]: '1' },
      });
    }
    // La primera todavía corre (o se cortó a mitad): que el worker pruebe después.
    return NextResponse.json({ error: 'in_progress' }, { status: 503, headers: { [RETRY_HEADER]: '1', 'retry-after': '5' } });
  }
  let res: NextResponse;
  try {
    res = await run();
  } catch (err) {
    await db.prepare('DELETE FROM offline_requests WHERE user_id = ? AND key = ?').run(userId, key).catch(() => undefined);
    throw err;
  }
  if (!res.ok) {
    await db.prepare('DELETE FROM offline_requests WHERE user_id = ? AND key = ?').run(userId, key).catch(() => undefined);
    return res;
  }
  const text = await res.clone().text().catch(() => '');
  await db
    .prepare('UPDATE offline_requests SET status = ?, body = ? WHERE user_id = ? AND key = ?')
    .run(res.status, text.length <= MAX_BODY ? text : '{}', userId, key)
    .catch(() => undefined);
  return res;
}

/** Cron horario: fuera las claves de más de 7 días (la cola no guarda cambios tanto tiempo sin red). */
export async function pruneOfflineRequests(): Promise<number> {
  const res = await getDb().prepare(`DELETE FROM offline_requests WHERE created_at < datetime('now', '-7 days')`).run();
  return res.changes;
}

export const BASE_HEADER = 'x-zs-base';
export const CONFLICT_HEADER = 'x-zs-conflict';

/**
 * ¿Alguien guardó otra versión después de la que la persona tenía cuando
 * editó? `base` es el updated_at que vio la página (header x-zs-base); sin
 * base no se sabe y no se avisa. Gana lo último que llega (se guarda igual);
 * esto solo decide si la página muestra "editado en otro lado".
 */
export function editedElsewhere(req: Request, currentUpdatedAt: string | null | undefined): boolean {
  const base = req.headers.get(BASE_HEADER);
  if (!base || !currentUpdatedAt) return false;
  const a = Date.parse(normalizeTs(base));
  const b = Date.parse(normalizeTs(currentUpdatedAt));
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  // Un segundo de margen: SQLite guarda datetime('now') sin milisegundos.
  return b - a > 1000;
}

/** "2026-11-08 10:00:00" (SQLite) → ISO en UTC. */
function normalizeTs(s: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
}
