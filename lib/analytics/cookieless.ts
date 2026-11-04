/**
 * Modo sin cookies. El snippet no guarda nada en el navegador y manda un
 * distinct_id fijo; acá se reemplaza por un hash de una sal diaria, el proyecto,
 * la IP, el navegador y el sitio. La sal se borra a los dos días: pasado ese
 * tiempo ya no se puede volver a calcular a quién corresponde un id, y la misma
 * persona en días distintos cuenta como visitantes distintos. No hay perfil de
 * persona y la IP no se guarda. Solo si el proyecto lo prendió. Server-only.
 */
import { createHash, randomBytes } from 'crypto';
import { getDb } from '../db';
import { bucketOf } from './compute';
import type { CleanEvent } from './ingest-core';
import type { ProjectRow } from './projects';
import { projectTz } from './tz';

export const COOKIELESS_SENTINELS = new Set(['$zs_cookieless', '$posthog_cookieless']);
export const COOKIELESS_PREFIX = 'ck_';
const SESSION_GAP_MS = 30 * 60_000;
const SALT_DAYS_KEPT = 2;
const DAY = 86_400_000;

export function isCookielessId(id: string): boolean {
  return COOKIELESS_SENTINELS.has(id);
}

/** El id de un visitante en un día: el mismo con los mismos datos, otro con otra sal. */
export function cookielessId(salt: string, projectId: string, ip: string, userAgent: string, host: string): string {
  const hash = createHash('sha256').update([salt, projectId, ip, userAgent, host.toLowerCase()].join('\u0000')).digest('hex');
  return `${COOKIELESS_PREFIX}${hash.slice(0, 40)}`;
}

const saltCache = new Map<string, string>();

/** Sal de un día: se crea la primera vez y la comparten todas las instancias. */
export async function dailySalt(day: string): Promise<string> {
  const hit = saltCache.get(day);
  if (hit) return hit;
  const db = getDb();
  await db.prepare('INSERT OR IGNORE INTO analytics_cookieless_salts (day, salt, created_at) VALUES (?, ?, ?)').run(day, randomBytes(32).toString('hex'), Date.now());
  const row = (await db.prepare('SELECT salt FROM analytics_cookieless_salts WHERE day = ?').get(day)) as { salt: string };
  if (saltCache.size > 8) saltCache.clear();
  saltCache.set(day, row.salt);
  return row.salt;
}

/** Borra las sales viejas (cron de cada hora). */
export async function purgeCookielessSalts(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - SALT_DAYS_KEPT * DAY).toISOString().slice(0, 10);
  saltCache.clear();
  const res = await getDb().prepare('DELETE FROM analytics_cookieless_salts WHERE day < ?').run(cutoff);
  return res.changes;
}

function hostOf(req: Request, e: CleanEvent | null): string {
  const fromEvent = e && typeof e.properties.$host === 'string' ? e.properties.$host : '';
  if (fromEvent) return fromEvent.slice(0, 255);
  const origin = req.headers.get('origin') ?? req.headers.get('referer') ?? '';
  try {
    return new URL(origin).host;
  } catch {
    return '';
  }
}

/** El id de hoy para este pedido. */
export async function cookielessIdFor(project: ProjectRow, req: Request, ip: string, at: number, event: CleanEvent | null = null): Promise<string> {
  const salt = await dailySalt(bucketOf(at, 'day', projectTz(project)));
  return cookielessId(salt, project.id, ip, req.headers.get('user-agent') ?? '', hostOf(req, event));
}

/**
 * Reemplaza el id fijo de los eventos sin cookies y les arma la sesión del lado
 * del servidor: la misma mientras no pasen 30 minutos sin eventos. Lo que depende
 * de saber quién es la persona ($identify, $set) no aplica y se saca.
 */
export async function applyCookieless(project: ProjectRow, events: CleanEvent[], req: Request, ip: string): Promise<CleanEvent[]> {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const lastByVisitor = new Map<string, { id: string; at: number } | null>();
  const out: CleanEvent[] = [];
  for (const e of sorted) {
    if (!isCookielessId(e.distinctId)) {
      out.push(e);
      continue;
    }
    if (e.event === '$identify' || e.event === '$create_alias' || e.event === '$set') continue;
    const id = await cookielessIdFor(project, req, ip, e.ts, e);
    let last = lastByVisitor.get(id);
    if (last === undefined) {
      const row = (await getDb()
        .prepare('SELECT id, ended_at FROM analytics_sessions WHERE project_id = ? AND distinct_id = ? ORDER BY ended_at DESC LIMIT 1')
        .get(project.id, id)) as { id: string; ended_at: number } | undefined;
      last = row ? { id: row.id, at: Number(row.ended_at) } : null;
    }
    const session = last && e.ts - last.at <= SESSION_GAP_MS ? last.id : `${id.slice(0, 40)}_${e.ts.toString(36)}`;
    lastByVisitor.set(id, { id: session, at: e.ts });
    const properties = { ...e.properties, $session_id: session };
    out.push({ ...e, distinctId: id, properties, set: null, setOnce: null } as CleanEvent);
  }
  return out;
}
