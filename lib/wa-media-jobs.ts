/**
 * Cola de archivos de WhatsApp por bajar (Inbox y Lines). Un archivo se baja
 * apenas llega; si no se pudo (el gateway no contestó, la línea estaba caída,
 * había muchos en la misma tanda), queda acá y el cron de cada minuto lo
 * vuelve a intentar con esperas cada vez más largas, de a pocos por línea
 * (sin apurar al gateway ni al teléfono). Server-only.
 *
 * - Bajó: sale de la cola.
 * - WhatsApp ya no lo tiene: sale de la cola (la pantalla lo dice y deja
 *   volver a pedirlo a mano).
 * - La línea está desvinculada: se espera sin gastar intentos, hasta dos
 *   semanas (al volver a vincular, se baja).
 * - Pasajero: se reintenta a 1 min, 5 min, 30 min, 2 h, 6 h y 24 h.
 */
import { getDb } from './db';

export type MediaJobApp = 'inbox' | 'lines';

/** Esperas entre intentos (ms). Agotadas, el trabajo se descarta: queda el botón de la pantalla. */
export const MEDIA_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 24 * 3_600_000];
/** Con la línea desvinculada: cada cuánto se mira de nuevo y hasta cuándo se espera. */
export const OFFLINE_RETRY_MS = 30 * 60_000;
export const OFFLINE_MAX_AGE_MS = 14 * 86_400_000;
/** Solo se baja solo lo reciente; lo más viejo se baja (y se guarda) cuando alguien lo abre. */
export const EAGER_MAX_AGE_MS = 30 * 86_400_000;
/** Archivos por línea en una corrida. */
const PER_SCOPE = 3;
const CLAIM_MS = 3 * 60_000;

/** ¿Vale la pena bajarlo solo? (por la fecha del mensaje). */
export function eagerWorthy(sentAt: string | undefined, now = Date.now()): boolean {
  const t = sentAt ? Date.parse(sentAt) : now;
  return Number.isFinite(t) && now - t < EAGER_MAX_AGE_MS;
}

/** Deja un archivo en la cola (una fila por mensaje: si ya está, no cambia). */
export async function queueMediaJob(app: MediaJobApp, scopeId: string, messageId: string, delayMs = 0, now = Date.now()): Promise<void> {
  await getDb()
    .prepare('INSERT INTO wa_media_jobs (app, message_id, scope_id, attempts, next_at, created_at) VALUES (?, ?, ?, 0, ?, ?) ON CONFLICT (app, message_id) DO NOTHING')
    .run(app, messageId, scopeId, new Date(now + delayMs).toISOString(), new Date(now).toISOString());
}

/** Saca un archivo de la cola (ya se bajó por otro camino). */
export async function dropMediaJob(app: MediaJobApp, messageId: string): Promise<void> {
  await getDb().prepare('DELETE FROM wa_media_jobs WHERE app = ? AND message_id = ?').run(app, messageId);
}

/** Lo que pasó con un intento. */
export type MediaJobResult = 'done' | 'gone' | 'offline' | 'pending';

interface JobRow {
  app: MediaJobApp;
  message_id: string;
  scope_id: string;
  attempts: number;
  created_at: string;
}

async function runInbox(job: JobRow): Promise<MediaJobResult> {
  const db = getDb();
  const msg = (await db.prepare('SELECT id, owner_id, thread_id, media_ref, media_type, revoked_at FROM inbox_messages WHERE id = ?').get(job.message_id)) as
    | { id: string; owner_id: string; thread_id: string; media_ref: string; media_type: string; revoked_at: string | null }
    | undefined;
  // El mensaje ya no está o no tiene cómo pedirse: no hay nada que bajar.
  if (!msg || !msg.media_ref || !msg.media_type) return 'gone';
  const { hasStoredMedia, inboxMedia } = await import('./inbox/media-store');
  if (await hasStoredMedia(msg.owner_id, msg.id)) return 'done';
  const { getAccountById } = await import('./inbox/core');
  const account = await getAccountById(job.scope_id);
  if (!account || account.owner_id !== msg.owner_id) return 'gone';
  if (account.status !== 'connected') return 'offline';
  try {
    await inboxMedia(account, msg.owner_id, msg);
    return (await hasStoredMedia(msg.owner_id, msg.id)) ? 'done' : 'pending';
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return code === 'media_gone' || code === 'not_found' ? 'gone' : code === 'not_connected' ? 'offline' : 'pending';
  }
}

async function runLines(job: JobRow): Promise<MediaJobResult> {
  const { getNumberRowById, getMessageRow, getChatRow, retryInboundMedia } = await import('./groups');
  const number = await getNumberRowById(job.scope_id);
  if (!number) return 'gone';
  const msg = await getMessageRow(number.user_id, job.message_id);
  if (!msg || msg.number_id !== number.id || !msg.media_type || msg.deleted_at) return 'gone';
  // Ya guardado (o marcado sin archivo por una falla definitiva): nada que hacer.
  if (!msg.media_url.startsWith('evo:')) return msg.media_url ? 'done' : 'gone';
  const chat = await getChatRow(number.user_id, msg.chat_id);
  if (!chat) return 'gone';
  const r = await retryInboundMedia(number, msg, chat.provider_chat_id);
  return 'url' in r ? 'done' : 'gone' in r ? 'gone' : 'offline' in r ? 'offline' : 'pending';
}

/**
 * Baja lo que toca. Entran como mucho PER_SCOPE trabajos por línea (los más
 * viejos de cada una: una línea con cientos pendientes no tapa a las demás) y
 * `limit` en total, hasta `deadline`. Cada fila se reclama antes (dos corridas
 * a la vez no bajan lo mismo) y el reclamo ya cuenta como intento: un trabajo
 * que tira abajo la corrida no se vuelve a tomar para siempre.
 */
export async function runMediaJobs(
  opts: { limit?: number; deadline?: number; run?: (job: JobRow) => Promise<MediaJobResult>; scopeId?: string } = {},
  now = Date.now(),
): Promise<Record<MediaJobResult, number>> {
  const db = getDb();
  const out: Record<MediaJobResult, number> = { done: 0, gone: 0, offline: 0, pending: 0 };
  const limit = Math.max(1, Math.min(50, opts.limit ?? 8));
  const nowIso = new Date(now).toISOString();
  const due = (await db
    .prepare(
      `SELECT app, message_id, scope_id, attempts, created_at FROM (
         SELECT app, message_id, scope_id, attempts, created_at, next_at,
                ROW_NUMBER() OVER (PARTITION BY app, scope_id ORDER BY next_at) AS rn
         FROM wa_media_jobs
         WHERE next_at <= ? AND (claimed_until IS NULL OR claimed_until < ?) ${opts.scopeId ? 'AND scope_id = ?' : ''}
       ) WHERE rn <= ? ORDER BY next_at LIMIT ?`,
    )
    .all(...(opts.scopeId ? [nowIso, nowIso, opts.scopeId, PER_SCOPE, limit * 4] : [nowIso, nowIso, PER_SCOPE, limit * 4]))) as unknown as JobRow[];
  /** Líneas que esta corrida ya vio desvinculadas: sus demás trabajos no se intentan. */
  const offline = new Set<string>();
  let taken = 0;
  for (const job of due) {
    if (taken >= limit || (opts.deadline && Date.now() > opts.deadline)) break;
    const scope = `${job.app}:${job.scope_id}`;
    if (offline.has(scope)) continue;
    const drop = () => db.prepare('DELETE FROM wa_media_jobs WHERE app = ? AND message_id = ?').run(job.app, job.message_id);
    const claim = await db
      .prepare('UPDATE wa_media_jobs SET claimed_until = ?, attempts = attempts + 1 WHERE app = ? AND message_id = ? AND next_at <= ? AND (claimed_until IS NULL OR claimed_until < ?)')
      .run(new Date(now + CLAIM_MS).toISOString(), job.app, job.message_id, nowIso, nowIso);
    if (!claim.changes) continue;
    // Agotó los intentos (o se cortó la corrida demasiadas veces con este trabajo): se descarta.
    const wait = MEDIA_BACKOFF_MS[job.attempts];
    if (wait === undefined) {
      await drop();
      out.gone++;
      continue;
    }
    taken++;
    let result: MediaJobResult;
    try {
      result = await (opts.run ?? (job.app === 'inbox' ? runInbox : runLines))(job);
    } catch {
      result = 'pending';
    }
    out[result]++;
    if (result === 'done' || result === 'gone') {
      await drop();
    } else if (result === 'offline') {
      // La línea está desvinculada: todos sus trabajos esperan juntos, sin gastar intentos (este tampoco), hasta
      // OFFLINE_MAX_AGE_MS desde que se encolaron.
      offline.add(scope);
      taken--;
      const again = new Date(now + OFFLINE_RETRY_MS).toISOString();
      await db.prepare('DELETE FROM wa_media_jobs WHERE app = ? AND scope_id = ? AND created_at < ?').run(job.app, job.scope_id, new Date(now - OFFLINE_MAX_AGE_MS).toISOString());
      await db
        .prepare("UPDATE wa_media_jobs SET claimed_until = NULL, attempts = MAX(0, attempts - 1), next_at = ?, last_kind = 'offline' WHERE app = ? AND message_id = ?")
        .run(again, job.app, job.message_id);
      await db
        .prepare("UPDATE wa_media_jobs SET next_at = ?, last_kind = 'offline' WHERE app = ? AND scope_id = ? AND next_at < ? AND (claimed_until IS NULL OR claimed_until < ?)")
        .run(again, job.app, job.scope_id, again, nowIso);
    } else {
      await db
        .prepare("UPDATE wa_media_jobs SET claimed_until = NULL, next_at = ?, last_kind = 'pending' WHERE app = ? AND message_id = ?")
        .run(new Date(now + wait).toISOString(), job.app, job.message_id);
    }
  }
  return out;
}
