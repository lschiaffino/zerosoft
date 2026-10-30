/**
 * Forms: marca de tiempo del render firmada por el servidor (HMAC). El
 * tiempo mínimo anti-spam se mide desde acá, no con lo que diga el cliente.
 * Server-only.
 */
import { createHmac, timingSafeEqual } from 'crypto';

/** Tiempo mínimo entre que se muestra el form y se envía. */
export const MIN_SUBMIT_MS = 2000;
/** Una página abierta más de una semana pide una marca nueva. */
const MAX_AGE_MS = 7 * 86_400_000;

function secret(): string {
  return `${process.env.NEXTAUTH_SECRET ?? process.env.ENCRYPTION_KEY ?? 'zerosoft-dev'}:forms-render`;
}

function sign(slug: string, ts: number): string {
  return createHmac('sha256', secret()).update(`${slug}:${ts}`).digest('base64url').slice(0, 32);
}

export function renderToken(slug: string, at = Date.now()): string {
  return `${at}.${sign(slug, at)}`;
}

export type RenderCheck = { ok: true } | { ok: false; waitMs: number; token: string };

/**
 * ¿Pasó el tiempo mínimo desde el render? Una marca que falta, no verifica o
 * venció se trata como sospechosa: hay que esperar el mínimo con una marca
 * nueva (que se devuelve) antes de reintentar.
 */
export function checkRenderToken(slug: string, token: string | undefined | null, now = Date.now()): RenderCheck {
  const m = /^(\d{10,16})\.([A-Za-z0-9_-]{32})$/.exec(token ?? '');
  if (m) {
    const ts = Number(m[1]);
    const good = Buffer.from(sign(slug, ts));
    const got = Buffer.from(m[2]);
    if (good.length === got.length && timingSafeEqual(good, got) && ts <= now + 60_000 && now - ts <= MAX_AGE_MS) {
      const elapsed = now - ts;
      return elapsed >= MIN_SUBMIT_MS ? { ok: true } : { ok: false, waitMs: MIN_SUBMIT_MS - elapsed, token: token! };
    }
  }
  return { ok: false, waitMs: MIN_SUBMIT_MS, token: renderToken(slug, now) };
}
