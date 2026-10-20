/**
 * Utilidades puras de la UI de Cal (sin React): slugs y claves derivadas,
 * contraste del color de marca y los límites "por defecto" de un evento.
 */

/** "Llamada inicial" → "llamada-inicial" (para la URL pública). */
export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Etiquetas que llenan los datos del invitado: la clave tiene que ser name/email. */
const NAME_KEYS = new Set(['name', 'nombre', 'nome', 'full_name', 'nombre_completo', 'nome_completo', 'your_name', 'tu_nombre', 'seu_nome']);
const EMAIL_KEYS = new Set(['email', 'e_mail', 'mail', 'correo', 'correo_electronico', 'tu_email', 'seu_email', 'your_email']);

/**
 * Clave técnica de una pregunta a partir de su etiqueta ("¿Cuál es tu empresa?" →
 * "cual_es_tu_empresa"). Empieza con letra (la API lo exige), máximo 64, y no
 * repite ninguna de `taken` (sufijo _2, _3…). "Nombre" y "Email" en cualquier
 * idioma pasan a name/email para que el routing pre-llene la reserva.
 */
export function fieldKeyFromLabel(label: string, taken: Iterable<string> = []): string {
  let key = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  if (NAME_KEYS.has(key)) key = 'name';
  else if (EMAIL_KEYS.has(key)) key = 'email';
  if (!key) key = 'pregunta';
  if (!/^[a-z]/.test(key)) key = `q_${key}`;
  const used = new Set(taken);
  if (!used.has(key)) return key;
  for (let i = 2; ; i++) {
    const next = `${key}_${i}`;
    if (!used.has(next)) return next;
  }
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa (WCAG) de un #rrggbb; null si no es un hex válido. */
export function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return 1;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Texto legible sobre un relleno del color de marca: blanco o tinta, el que más contraste dé. */
export function textOn(hex: string): '#ffffff' | '#111111' {
  return contrast(hex, '#ffffff') >= contrast(hex, '#111111') ? '#ffffff' : '#111111';
}

/** Color de marca válido o el de respaldo. */
export function brandOr(hex: string | null | undefined, fallback: string): string {
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
}

/** Logo usable en una página pública: https, http o una ruta propia. */
export function safeLogo(url: string | null | undefined): string | null {
  const v = url?.trim();
  return v && /^(https?:\/\/|\/)/.test(v) ? v : null;
}

/** Marca ya resuelta para una página pública: color, texto sobre el color, logo y nombre. */
export interface PublicBrand {
  color: string;
  on: '#ffffff' | '#111111';
  logoUrl: string | null;
  name: string;
}

/**
 * La marca del workspace, con el color y el logo del tipo de evento como
 * excepción si los tiene. Sin color en ningún lado, tinta.
 */
export function resolveBrand(
  workspace: { color: string | null; logoUrl: string | null; name: string },
  eventType?: { brand_color?: string | null; logo_url?: string | null } | null,
): PublicBrand {
  const color = brandOr(eventType?.brand_color, brandOr(workspace.color, '#111111'));
  return {
    color,
    on: textOn(color),
    logoUrl: safeLogo(eventType?.logo_url) ?? safeLogo(workspace.logoUrl),
    name: workspace.name,
  };
}

/**
 * Zona horaria legible: "America/Argentina/Buenos_Aires" → "Buenos Aires (GMT-3)".
 * Es para leer, no para copiar: va en Archivo, no en mono.
 */
export function formatTimezone(tz: string, locale = 'en', at: Date = new Date()): string {
  const city = (tz.split('/').pop() || tz).replace(/_/g, ' ');
  let offset = '';
  try {
    offset =
      new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'shortOffset' })
        .formatToParts(at)
        .find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return city;
  }
  if (!offset || tz === 'UTC' || tz === 'Etc/UTC') return tz === 'Etc/UTC' ? 'UTC' : city;
  return `${city} (${offset})`;
}

export const LIMIT_KEYS = ['bufferBeforeMin', 'bufferAfterMin', 'minNoticeHours', 'maxFutureDays'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type Limits = Record<LimitKey, number>;

/** El evento usa los valores por defecto del calendario si no define ninguno de los cuatro límites. */
export function usesDefaultLimits(rules: Record<string, unknown> | null | undefined): boolean {
  return !LIMIT_KEYS.some((k) => typeof rules?.[k] === 'number');
}

/**
 * Reglas de reserva para guardar: con `useDefaults` se omiten los límites (el
 * motor cae a los del calendario); si no, van los cuatro. Lo demás (p. ej.
 * allowGuests) se conserva tal cual.
 */
export function bookingRulesPayload(
  previous: Record<string, unknown> | null | undefined,
  useDefaults: boolean,
  limits: Limits,
): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(previous ?? {})) {
    if (!(LIMIT_KEYS as readonly string[]).includes(k)) rest[k] = v;
  }
  return useDefaults ? rest : { ...rest, ...limits };
}

/** Topes de reuniones como texto del formulario ('' = sin tope). */
export type MeetingLimitsDraft = Record<'day' | 'week' | 'month', string>;

export function meetingLimitsDraft(raw: unknown): MeetingLimitsDraft {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const one = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? String(v) : '');
  return { day: one(src.day), week: one(src.week), month: one(src.month) };
}

/**
 * Topes para guardar: solo los completos. undefined si no hay ninguno (la
 * clave desaparece de booking_rules); null si alguno no es un entero de 1 a 1000.
 */
export function meetingLimitsPayload(draft: MeetingLimitsDraft): Record<string, number> | undefined | null {
  const out: Record<string, number> = {};
  for (const k of ['day', 'week', 'month'] as const) {
    const v = draft[k].trim();
    if (!v) continue;
    if (!/^\d+$/.test(v)) return null;
    const n = Number(v);
    if (n < 1 || n > 1000) return null;
    out[k] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
