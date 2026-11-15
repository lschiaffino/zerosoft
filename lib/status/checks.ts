import { getClient } from '@/lib/db';
import type { ComponentStatus } from './components';
import { redactSecrets } from './redact';

/**
 * Los chequeos que corre el cron de cada minuto. Cada uno devuelve un estado y,
 * si falló, el error crudo (sin secretos: redactSecrets). Un chequeo sin
 * configurar (sin la variable del servicio) devuelve null y no se registra.
 *
 * STATUS_CHECKS_FAKE=1 (e2e, offline): todo up sin salir a la red, salvo la base, que es local.
 */

export interface CheckResult {
  status: Exclude<ComponentStatus, 'unknown'>;
  /** Error crudo para el email y la API del watcher (nunca para la página pública). */
  error?: string;
  /** Detalle interno corto (p. ej. "6/8 instances open"). */
  detail?: string;
  ms: number;
}

const TIMEOUT_MS = 10_000;
const SLOW_MS = 5_000;

async function timed(run: () => Promise<Omit<CheckResult, 'ms'>>): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const r = await run();
    return { ...r, ms: Date.now() - t0 };
  } catch (err) {
    return { status: 'down', error: errorText(err), ms: Date.now() - t0 };
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const c = cause instanceof Error ? `: ${cause.message}` : '';
    const name = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timeout' : err.name;
    return redactSecrets(`${name}: ${err.message}${c}`);
  }
  return redactSecrets(err);
}

function siteOrigin(): string {
  const raw = process.env.STATUS_SITE_URL || process.env.NEXTAUTH_URL || 'https://zerosoft.ai';
  try {
    return new URL(raw).origin;
  } catch {
    return 'https://zerosoft.ai';
  }
}

/** La home (siguiendo el redirect al idioma) y /api/version. */
export async function checkWeb(): Promise<CheckResult> {
  return timed(async () => {
    const origin = siteOrigin();
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const t0 = Date.now();
    const [home, version] = await Promise.all([
      fetch(`${origin}/`, { redirect: 'follow', cache: 'no-store', signal, headers: { 'user-agent': 'zerosoft-status' } }),
      fetch(`${origin}/api/version`, { cache: 'no-store', signal, headers: { 'user-agent': 'zerosoft-status' } }),
    ]);
    const ms = Date.now() - t0;
    // Solo el código: el cuerpo de la home no hace falta.
    await home.body?.cancel().catch(() => undefined);
    // 401/403/429: un firewall o el límite de pedidos frenó al chequeo, no al sitio. No es una caída.
    const blocked = (code: number) => code === 401 || code === 403 || code === 429;
    if (blocked(home.status) || blocked(version.status)) return { status: 'up', detail: `check blocked (HTTP ${home.status}/${version.status})` };
    if (!home.ok) return { status: 'down', error: `home returned HTTP ${home.status}` };
    if (!version.ok) return { status: 'down', error: `/api/version returned HTTP ${version.status}` };
    const body = (await version.json().catch(() => null)) as { build?: unknown } | null;
    if (!body || typeof body.build !== 'string') return { status: 'degraded', error: '/api/version answered without a build id' };
    if (ms > SLOW_MS) return { status: 'degraded', error: `slow: ${ms} ms`, detail: `build ${body.build.slice(0, 12)}` };
    return { status: 'up', detail: `build ${body.build.slice(0, 12)}` };
  });
}

/** Turso bloquea lecturas o escrituras por cuota del plan con este tipo de error. */
export function isQuotaError(message: string): boolean {
  return /\bBLOCKED\b|blocked|quota|limit exceeded|exceeded.*(limit|quota)|forbidden/i.test(message);
}

/** Una lectura mínima (SELECT 1): sin tocar tablas, una sola fila. */
export async function checkDatabase(): Promise<CheckResult> {
  return timed(async () => {
    const t0 = Date.now();
    try {
      await Promise.race([
        getClient().execute('SELECT 1'),
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('no answer in 5 s'), { name: 'TimeoutError' })), 5_000)),
      ]);
    } catch (err) {
      const text = errorText(err);
      return { status: 'down', error: isQuotaError(text) ? `quota/blocked: ${text}` : text, detail: isQuotaError(text) ? 'blocked' : undefined };
    }
    const ms = Date.now() - t0;
    if (ms > 2_000) return { status: 'degraded', error: `slow: ${ms} ms` };
    return { status: 'up' };
  });
}

interface EvolutionInstance {
  name?: string;
  instanceName?: string;
  connectionStatus?: string;
  instance?: { instanceName?: string; state?: string; status?: string };
}

/**
 * Evolution API (GROUPS_BRIDGE_URL + GROUPS_BRIDGE_KEY): la lista de instancias
 * y una consulta que pasa por su Postgres (findMessages de 1 registro). Con la
 * base caída, Evolution sigue respondiendo /instance/fetchInstances desde la
 * caché a veces; findMessages no.
 */
export async function checkWhatsapp(): Promise<CheckResult | null> {
  const base = String(process.env.GROUPS_BRIDGE_URL ?? '').trim().replace(/\/+$/, '');
  const key = String(process.env.GROUPS_BRIDGE_KEY ?? '').trim();
  if (!base || !key) return null;
  return timed(async () => {
    const t0 = Date.now();
    const headers = { apikey: key, 'content-type': 'application/json' };
    const res = await fetch(`${base}/instance/fetchInstances`, { headers, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { status: 'down', error: `fetchInstances HTTP ${res.status}: ${redactSecrets((await res.text().catch(() => '')).slice(0, 300))}` };
    const list = (await res.json().catch(() => null)) as EvolutionInstance[] | null;
    if (!Array.isArray(list)) return { status: 'down', error: 'fetchInstances did not return a list' };
    const names = list.map((i) => i.name ?? i.instanceName ?? i.instance?.instanceName ?? '').filter(Boolean);
    const open = list.filter((i) => (i.connectionStatus ?? i.instance?.state ?? i.instance?.status) === 'open');
    const detail = `${open.length}/${list.length} instances open`;
    const probe = open[0] ? open[0].name ?? open[0].instanceName ?? open[0].instance?.instanceName : names[0];
    if (probe) {
      const q = await fetch(`${base}/chat/findMessages/${encodeURIComponent(probe)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ where: {}, offset: 1, page: 1 }),
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = (await q.text().catch(() => '')).slice(0, 300);
      if (!q.ok) return { status: 'down', error: `findMessages (database) HTTP ${q.status}: ${redactSecrets(text)}`, detail };
    }
    const ms = Date.now() - t0;
    if (list.length > 0 && open.length === 0) return { status: 'degraded', error: `no instance is connected (${detail})`, detail };
    if (ms > 8_000) return { status: 'degraded', error: `slow: ${ms} ms`, detail };
    return { status: 'up', detail };
  });
}

/**
 * Resend: que la API responda. Una key de solo envío contesta 401 en /domains:
 * eso igual prueba que la API está viva. Solo 5xx, 429 sostenido o la red caída cuentan.
 */
export async function checkEmail(): Promise<CheckResult | null> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  return timed(async () => {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.body?.cancel().catch(() => undefined);
    if (res.status >= 500) return { status: 'down', error: `Resend API HTTP ${res.status}` };
    return { status: 'up' };
  });
}

/** Todos los chequeos del cron, en paralelo. */
export async function runChecks(): Promise<Record<string, CheckResult>> {
  if (process.env.STATUS_CHECKS_FAKE === '1') {
    const db = await checkDatabase();
    return { web: { status: 'up', ms: 0 }, database: db, whatsapp: { status: 'up', ms: 0 }, email: { status: 'up', ms: 0 } };
  }
  const [web, database, whatsapp, email] = await Promise.all([checkWeb(), checkDatabase(), checkWhatsapp(), checkEmail()]);
  const out: Record<string, CheckResult> = { web, database };
  if (whatsapp) out.whatsapp = whatsapp;
  if (email) out.email = email;
  return out;
}
