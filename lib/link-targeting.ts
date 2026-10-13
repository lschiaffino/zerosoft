import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { isValidUrl, normalizeUrl } from './utils';

/**
 * Segmentación de un link: reglas por país y dispositivo, destinos A/B con
 * pesos y deep links a apps de iOS/Android. Vive como JSON en links.targeting
 * (misma fila que lee el redirect): sin reglas, el redirect no hace nada extra.
 *
 * Orden de resolución:
 * 1. Deep link del dispositivo (iOS/Android). Si la app no abre, el fallback
 *    (tienda o web) o el destino que resulte de 2 y 3.
 * 2. Primera regla que coincide (país y dispositivo; lista vacía = cualquiera).
 * 3. A/B con pesos, fijo por visitante (cookie zs_vid + hash determinístico).
 * 4. La URL del link.
 */

export const DEVICE_TARGETS = ['ios', 'android', 'desktop'] as const;
export type DeviceTarget = (typeof DEVICE_TARGETS)[number];

export const VISITOR_COOKIE = 'zs_vid';

const webUrl = z.string().trim().min(1).max(2000);
/** URL de app: esquema propio (miapp://) o universal link https. */
const appUrl = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((v) => /^[a-z][a-z0-9+.-]*:/i.test(v) && !/^(javascript|data|vbscript|file|blob):/i.test(v), 'invalid_app_url');

const deepLinkSchema = z.object({ app: appUrl, fallback: webUrl.optional().nullable() });

export const linkTargetingSchema = z.object({
  rules: z
    .array(
      z.object({
        countries: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)).max(60).default([]),
        devices: z.array(z.enum(DEVICE_TARGETS)).max(3).default([]),
        url: webUrl,
      }),
    )
    .max(20)
    .default([]),
  ab: z
    .array(z.object({ url: webUrl, weight: z.number().int().min(0).max(100) }))
    .max(5)
    .default([]),
  ios: deepLinkSchema.nullable().optional(),
  android: deepLinkSchema.nullable().optional(),
});

export type LinkTargetingInput = z.input<typeof linkTargetingSchema>;

export interface LinkTargeting {
  rules: Array<{ countries: string[]; devices: DeviceTarget[]; url: string }>;
  ab: Array<{ url: string; weight: number }>;
  ios: { app: string; fallback: string | null } | null;
  android: { app: string; fallback: string | null } | null;
}

function cleanWeb(raw: string): string | null {
  const url = normalizeUrl(raw);
  return isValidUrl(url) ? url : null;
}

/**
 * Valida y normaliza. Devuelve null si no queda nada configurado (así el
 * link vuelve al camino rápido) o un código de error.
 */
export function normalizeTargeting(
  input: z.infer<typeof linkTargetingSchema>,
): { ok: true; value: LinkTargeting | null } | { ok: false; error: string } {
  const rules: LinkTargeting['rules'] = [];
  for (const r of input.rules) {
    const url = cleanWeb(r.url);
    if (!url) return { ok: false, error: 'invalid_targeting_url' };
    const countries = [...new Set(r.countries)];
    const devices = [...new Set(r.devices)];
    if (countries.length === 0 && devices.length === 0) return { ok: false, error: 'empty_rule' };
    rules.push({ countries, devices, url });
  }
  const ab: LinkTargeting['ab'] = [];
  for (const v of input.ab) {
    const url = cleanWeb(v.url);
    if (!url) return { ok: false, error: 'invalid_targeting_url' };
    ab.push({ url, weight: v.weight });
  }
  if (ab.length === 1) return { ok: false, error: 'ab_needs_two' };
  if (ab.length > 0 && ab.every((v) => v.weight === 0)) return { ok: false, error: 'ab_zero_weight' };

  const deep = (d: z.infer<typeof deepLinkSchema> | null | undefined) => {
    if (!d) return { ok: true as const, value: null };
    let fallback: string | null = null;
    if (d.fallback) {
      fallback = cleanWeb(d.fallback);
      if (!fallback) return { ok: false as const };
    }
    return { ok: true as const, value: { app: d.app, fallback } };
  };
  const ios = deep(input.ios);
  const android = deep(input.android);
  if (!ios.ok || !android.ok) return { ok: false, error: 'invalid_targeting_url' };

  if (rules.length === 0 && ab.length === 0 && !ios.value && !android.value) return { ok: true, value: null };
  return { ok: true, value: { rules, ab, ios: ios.value, android: android.value } };
}

/** Lee la columna links.targeting. JSON roto = sin reglas (nunca rompe el redirect). */
export function parseTargeting(raw: string | null | undefined): LinkTargeting | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LinkTargeting>;
    return {
      rules: Array.isArray(v.rules) ? v.rules : [],
      ab: Array.isArray(v.ab) ? v.ab : [],
      ios: v.ios ?? null,
      android: v.android ?? null,
    };
  } catch {
    return null;
  }
}

export interface VisitorContext {
  country: string | null;
  os: string;
  device: string;
}

/** iOS / Android por sistema operativo; todo lo demás cuenta como desktop. */
export function deviceClass(ctx: Pick<VisitorContext, 'os'>): DeviceTarget {
  const os = ctx.os.toLowerCase();
  if (os === 'ios' || os === 'ipados') return 'ios';
  if (os === 'android') return 'android';
  return 'desktop';
}

/** Índice elegido por peso, determinístico para el mismo seed. */
export function pickWeighted(weights: number[], seed: string): number {
  const total = weights.reduce((s, w) => s + Math.max(w, 0), 0);
  if (total <= 0) return 0;
  const h = createHash('sha256').update(seed).digest();
  const point = (h.readUInt32BE(0) / 0x100000000) * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += Math.max(weights[i], 0);
    if (point < acc) return i;
  }
  return weights.length - 1;
}

export function newVisitorId(): string {
  return randomBytes(12).toString('hex');
}

export type Resolution =
  | { kind: 'redirect'; url: string; variant: string | null }
  | { kind: 'deeplink'; appUrl: string; fallbackUrl: string; variant: string };

function webDestination(
  defaultUrl: string,
  t: LinkTargeting,
  ctx: VisitorContext,
  device: DeviceTarget,
  seed: string,
): { url: string; variant: string | null } {
  for (let i = 0; i < t.rules.length; i++) {
    const r = t.rules[i];
    const countryOk = r.countries.length === 0 || (!!ctx.country && r.countries.includes(ctx.country.toUpperCase()));
    const deviceOk = r.devices.length === 0 || r.devices.includes(device);
    if (countryOk && deviceOk) return { url: r.url, variant: `rule:${i + 1}` };
  }
  if (t.ab.length > 1) {
    const i = pickWeighted(
      t.ab.map((v) => v.weight),
      seed,
    );
    return { url: t.ab[i].url, variant: `ab:${String.fromCharCode(65 + i)}` };
  }
  return { url: defaultUrl, variant: null };
}

/**
 * Destino para esta visita. `seed` = `${visitorId}:${linkId}`: el mismo
 * visitante cae siempre en la misma variante A/B.
 */
export function resolveDestination(
  defaultUrl: string,
  t: LinkTargeting | null,
  ctx: VisitorContext,
  seed: string,
): Resolution {
  if (!t) return { kind: 'redirect', url: defaultUrl, variant: null };
  const device = deviceClass(ctx);
  const web = webDestination(defaultUrl, t, ctx, device, seed);
  const deep = device === 'ios' ? t.ios : device === 'android' ? t.android : null;
  if (deep) {
    // Universal link / app link: el sistema decide si abre la app.
    if (/^https?:/i.test(deep.app)) return { kind: 'redirect', url: deep.app, variant: `app:${device}` };
    return { kind: 'deeplink', appUrl: deep.app, fallbackUrl: deep.fallback ?? web.url, variant: `app:${device}` };
  }
  return { kind: 'redirect', ...web };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Página mínima que intenta abrir la app y, si no abre, va al fallback. */
export function deepLinkHtml(appUrl: string, fallbackUrl: string): string {
  const js = JSON.stringify({ a: appUrl, f: fallbackUrl }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>…</title></head><body style="font-family:system-ui,sans-serif;padding:24px"><p><a href="${escapeHtml(fallbackUrl)}">${escapeHtml(fallbackUrl)}</a></p><script>(function(){var d=${js};var t=setTimeout(function(){location.replace(d.f)},1500);document.addEventListener('visibilitychange',function(){if(document.hidden)clearTimeout(t)});location.href=d.a})();</script></body></html>`;
}
