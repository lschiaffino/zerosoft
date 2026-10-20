/**
 * Cal — puro (sin DB): parámetros UTM de la página de reserva y la URL a la
 * que se manda al invitado después de reservar.
 */

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export type Utm = Partial<Record<UtmKey, string>>;

const UTM_MAX = 200;

/**
 * Solo las cinco claves utm_*, como texto de una línea y hasta 200
 * caracteres. Acepta un objeto suelto o los searchParams de la página (un
 * valor repetido toma el primero). Sin ninguna, objeto vacío.
 */
export function sanitizeUtm(raw: unknown): Utm {
  const out: Utm = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of UTM_KEYS) {
    let v = (raw as Record<string, unknown>)[key];
    if (Array.isArray(v)) v = v[0];
    if (typeof v !== 'string') continue;
    // eslint-disable-next-line no-control-regex
    const clean = v.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, UTM_MAX);
    if (clean) out[key] = clean;
  }
  return out;
}

/** UTM guardado en la reserva (JSON) de vuelta como objeto; inválido = vacío. */
export function parseUtm(json: string | null | undefined): Utm {
  if (!json) return {};
  try {
    return sanitizeUtm(JSON.parse(json));
  } catch {
    return {};
  }
}

/** URL de redirección válida: absoluta, http o https, sin credenciales. */
export function isValidRedirectUrl(value: string): boolean {
  if (value.length > 2000) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && !!url.hostname;
  } catch {
    return false;
  }
}

export interface RedirectDetails {
  bookingId: string;
  status: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  name: string;
  email: string;
  eventSlug: string;
  eventTitle: string;
  utm?: Utm;
}

/**
 * Destino después de reservar. Con `passDetails`, la URL lleva los datos de la
 * reserva como parámetros (los que ya tenía se conservan, salvo los que se
 * pisan); sin, va tal cual. null si la URL configurada no es válida.
 */
export function buildRedirectUrl(base: string, passDetails: boolean, details: RedirectDetails): string | null {
  if (!isValidRedirectUrl(base)) return null;
  const url = new URL(base);
  if (passDetails) {
    const set: Array<[string, string]> = [
      ['booking_id', details.bookingId],
      ['status', details.status],
      ['start', details.startsAt],
      ['end', details.endsAt],
      ['timezone', details.timezone],
      ['name', details.name],
      ['email', details.email],
      ['event', details.eventSlug],
      ['event_title', details.eventTitle],
    ];
    for (const [k, v] of set) url.searchParams.set(k, v);
    for (const [k, v] of Object.entries(details.utm ?? {})) if (v) url.searchParams.set(k, v);
  }
  return url.toString();
}
