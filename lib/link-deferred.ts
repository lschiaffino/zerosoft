/**
 * Deep linking diferido (como Dub y los ex Firebase Dynamic Links): alguien
 * toca un link con app en el celular, no tiene la app, va a la tienda, la
 * instala y, al abrirla por primera vez, la app pregunta
 * POST /api/v1/links/track/open qué link la trajo para abrir esa pantalla.
 *
 * Coincidencia probabilística por IP y plataforma en la última hora, sin
 * guardar datos personales: solo un hash con sal (HMAC con el secreto de la
 * instancia) que se borra a la hora. Cada coincidencia se usa una sola vez.
 * Server-only.
 */
import { createHmac } from 'crypto';
import { getDb } from './db';
import { isAppHost, normalizeHost } from './hosts';
import { shortDomain } from './utils';

export const DEFERRED_TTL_MINUTES = 60;

export type DeferredPlatform = 'ios' | 'android';

function secret(): string {
  return process.env.NEXTAUTH_SECRET || 'zerosoft-deferred-dev';
}

/** Hash de IP + plataforma (sin la IP en claro). */
export function deferredFingerprint(ip: string, platform: DeferredPlatform): string {
  return createHmac('sha256', secret()).update(`deferred|${platform}|${ip.trim().toLowerCase()}`).digest('hex').slice(0, 40);
}

/** Plataforma de la variante servida ('app:ios' → 'ios'). */
export function platformOfVariant(variant: string | null | undefined): DeferredPlatform | null {
  if (variant === 'app:ios') return 'ios';
  if (variant === 'app:android') return 'android';
  return null;
}

/** Guarda la visita para una posible apertura de la app (se llama después de responder). */
export async function recordDeferredClick(input: {
  ip: string;
  platform: DeferredPlatform;
  linkId: string;
  clickId: string | null;
}): Promise<void> {
  if (!input.ip || input.ip === 'unknown') return;
  try {
    await getDb()
      .prepare('INSERT INTO link_deferred (fingerprint, link_id, click_id) VALUES (?, ?, ?)')
      .run(deferredFingerprint(input.ip, input.platform), input.linkId, input.clickId);
  } catch {
    /* nunca rompe la visita */
  }
}

export interface DeferredMatch {
  linkId: string;
  clickId: string | null;
}

/**
 * La visita más reciente de esa IP y plataforma en la última hora (y del
 * dominio pedido, si viene). Se consume: la próxima apertura no la recibe.
 */
export async function matchDeferredClick(input: {
  /** Workspace de la publishable key: solo sus links. */
  ws: string;
  ip: string;
  platform: DeferredPlatform;
  /** Hostname del dominio propio, o null para cualquier dominio. */
  domain?: string | null;
}): Promise<DeferredMatch | null> {
  if (!input.ip || input.ip === 'unknown') return null;
  const db = getDb();
  const fp = deferredFingerprint(input.ip, input.platform);
  const domain = input.domain?.trim().toLowerCase().replace(/^www\./, '') || null;
  // El dominio de zerosoft (SHORT_DOMAIN o el de la app) son los links sin dominio propio.
  const isDefault = !!domain && (isAppHost(domain) || normalizeHost(shortDomain()).replace(/:\d+$/, '') === domain.replace(/:\d+$/, ''));
  const domainSql = !domain ? '' : isDefault ? 'AND l.domain_id IS NULL' : 'AND d.hostname = ?';
  const args: string[] = [fp, `-${DEFERRED_TTL_MINUTES} minutes`, input.ws];
  if (domain && !isDefault) args.push(domain);
  const row = (await db
    .prepare(
      `SELECT f.id, f.link_id, f.click_id FROM link_deferred f
       JOIN links l ON l.id = f.link_id LEFT JOIN link_domains d ON d.id = l.domain_id
       WHERE f.fingerprint = ? AND f.created_at >= datetime('now', ?) AND l.user_id = ?
         ${domainSql}
       ORDER BY f.id DESC LIMIT 1`,
    )
    .get(...args)) as
    | { id: number; link_id: string; click_id: string | null }
    | undefined;
  if (!row) return null;
  const claimed = await db.prepare('DELETE FROM link_deferred WHERE id = ?').run(row.id);
  if (claimed.changes !== 1) return null;
  return { linkId: row.link_id, clickId: row.click_id };
}

/** Borra lo vencido (cron). */
export async function pruneDeferredClicks(): Promise<number> {
  const res = await getDb()
    .prepare(`DELETE FROM link_deferred WHERE created_at < datetime('now', ?)`)
    .run(`-${DEFERRED_TTL_MINUTES} minutes`);
  return res.changes;
}
