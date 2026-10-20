/**
 * Helpers puros de URLs de destino de Link (sin DB): se usan en el servidor
 * (/r, PATCH) y en el editor del cliente.
 */

/** Params que usa zerosoft en el link corto y que nunca viajan al destino. */
export const RESERVED_LINK_PARAMS: ReadonlySet<string> = new Set(['qr']);

/**
 * Suma al destino los query params que trae el link corto (go.empresa.com/promo?utm_source=mail).
 * En conflicto gana el del link corto; los reservados (?qr=1) se descartan.
 * Un destino que no parsea se devuelve tal cual.
 */
export function forwardQueryParams(destination: string, incoming: URLSearchParams): string {
  const keys = [...new Set(incoming.keys())].filter((k) => k && !RESERVED_LINK_PARAMS.has(k));
  if (keys.length === 0) return destination;
  let u: URL;
  try {
    u = new URL(destination);
  } catch {
    return destination;
  }
  for (const key of keys) {
    u.searchParams.delete(key);
    for (const value of incoming.getAll(key)) u.searchParams.append(key, value);
  }
  return u.toString();
}

/**
 * Query string ("?a=1&b=2" o '') para pasar por la puerta de contraseña: la
 * visita llega a /gate con los params del link corto y vuelve a /<slug> con
 * los mismos, así el redirect final los reenvía al destino (y ?qr=1 sigue
 * contando el escaneo). Acepta los searchParams de una página de Next.
 */
export function gateQueryString(
  params: URLSearchParams | Record<string, string | string[] | undefined> | null | undefined,
): string {
  if (!params) return '';
  let out: URLSearchParams;
  if (params instanceof URLSearchParams) {
    out = new URLSearchParams(params);
  } else {
    out = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (!key || value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) out.append(key, v);
    }
  }
  const qs = out.toString();
  return qs ? `?${qs}` : '';
}

export const UTM_KEYS = {
  source: 'utm_source',
  medium: 'utm_medium',
  campaign: 'utm_campaign',
  term: 'utm_term',
  content: 'utm_content',
} as const;
export type UtmField = keyof typeof UTM_KEYS;
export type UtmValues = Record<UtmField, string | null>;

function parseLoose(url: string): URL | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

export const UTM_FIELDS = Object.keys(UTM_KEYS) as UtmField[];

/** utm_source/medium/campaign/term/content que tiene hoy la URL (null si falta o está vacío). */
export function readUtm(url: string): UtmValues {
  const u = parseLoose(url);
  const get = (k: string) => u?.searchParams.get(k)?.trim() || null;
  return {
    source: get(UTM_KEYS.source),
    medium: get(UTM_KEYS.medium),
    campaign: get(UTM_KEYS.campaign),
    term: get(UTM_KEYS.term),
    content: get(UTM_KEYS.content),
  };
}

/**
 * Aplica cambios de UTM a la URL: undefined deja el param como está, '' o
 * null lo saca, un texto lo pone. Si nada cambia, la URL vuelve idéntica (sin
 * normalizar barras ni encoding). Devuelve la URL y los UTM que quedaron en ella.
 */
export function syncUtm(
  url: string,
  changes: Partial<Record<UtmField, string | null | undefined>> = {},
): { url: string; utm: UtmValues } {
  const current = readUtm(url);
  const u = parseLoose(url);
  if (!u) return { url, utm: current };
  let dirty = false;
  for (const field of UTM_FIELDS) {
    const change = changes[field];
    if (change === undefined) continue;
    const next = change?.trim() || null;
    if (next === current[field]) continue;
    dirty = true;
    if (next) u.searchParams.set(UTM_KEYS[field], next);
    else u.searchParams.delete(UTM_KEYS[field]);
  }
  if (!dirty) return { url, utm: current };
  const out = u.toString();
  return { url: out, utm: readUtm(out) };
}

/**
 * URL del referrer para guardar en el click: solo http(s), sin hash ni
 * query salvo los utm_* (el resto puede traer tokens, emails o ids de
 * sesión). Máximo 500 caracteres; null si no hay o no parsea.
 */
export function cleanReferrerUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const kept = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (/^utm_[a-z]+$/i.test(k)) kept.append(k, v);
  u.hash = '';
  u.username = '';
  u.password = '';
  u.search = kept.toString();
  const out = u.toString();
  return out.length > 500 ? out.slice(0, 500) : out;
}
