/**
 * Robots — país de la corrida: idioma, zona horaria y (si hay un proveedor
 * configurado) proxy de salida. Server-only.
 *
 * Sin proveedor, el país cambia el idioma del navegador (Accept-Language y
 * navigator.language) y la zona horaria; la IP es la del runner.
 *
 * Con proveedor (ROBOTS_PROXY_URL), cada corrida sale por ese proxy. La URL
 * admite dos marcadores que entienden los proveedores residenciales (Bright
 * Data, Oxylabs, Smartproxy, IPRoyal…) en el usuario:
 *   {country}  → código del país en minúsculas (us, ar, br…)
 *   {session}  → id al azar por corrida: IP nueva en cada corrida (rotación)
 * Ej.: http://customer-acme-cc-{country}-sessid-{session}:SECRET@pr.oxylabs.io:7777
 * ROBOTS_PROXY_COUNTRIES (opcional) limita los países ofrecidos (us,ar,br,…).
 *
 * El proxy lo elige quien opera la instancia (env), nunca el usuario: el
 * arnés sigue bloqueando hosts privados en cada pedido.
 */

export interface CountryInfo {
  code: string;
  locale: string;
  timezoneId: string;
}

/** Países con idioma y zona horaria de su capital comercial. */
export const COUNTRIES: readonly CountryInfo[] = [
  { code: 'us', locale: 'en-US', timezoneId: 'America/New_York' },
  { code: 'ca', locale: 'en-CA', timezoneId: 'America/Toronto' },
  { code: 'mx', locale: 'es-MX', timezoneId: 'America/Mexico_City' },
  { code: 'ar', locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' },
  { code: 'br', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
  { code: 'cl', locale: 'es-CL', timezoneId: 'America/Santiago' },
  { code: 'co', locale: 'es-CO', timezoneId: 'America/Bogota' },
  { code: 'pe', locale: 'es-PE', timezoneId: 'America/Lima' },
  { code: 'uy', locale: 'es-UY', timezoneId: 'America/Montevideo' },
  { code: 'gb', locale: 'en-GB', timezoneId: 'Europe/London' },
  { code: 'ie', locale: 'en-IE', timezoneId: 'Europe/Dublin' },
  { code: 'es', locale: 'es-ES', timezoneId: 'Europe/Madrid' },
  { code: 'pt', locale: 'pt-PT', timezoneId: 'Europe/Lisbon' },
  { code: 'fr', locale: 'fr-FR', timezoneId: 'Europe/Paris' },
  { code: 'de', locale: 'de-DE', timezoneId: 'Europe/Berlin' },
  { code: 'it', locale: 'it-IT', timezoneId: 'Europe/Rome' },
  { code: 'nl', locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' },
  { code: 'se', locale: 'sv-SE', timezoneId: 'Europe/Stockholm' },
  { code: 'pl', locale: 'pl-PL', timezoneId: 'Europe/Warsaw' },
  { code: 'in', locale: 'en-IN', timezoneId: 'Asia/Kolkata' },
  { code: 'jp', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' },
  { code: 'kr', locale: 'ko-KR', timezoneId: 'Asia/Seoul' },
  { code: 'sg', locale: 'en-SG', timezoneId: 'Asia/Singapore' },
  { code: 'au', locale: 'en-AU', timezoneId: 'Australia/Sydney' },
  { code: 'za', locale: 'en-ZA', timezoneId: 'Africa/Johannesburg' },
];

export function countryInfo(code: string | undefined | null): CountryInfo | null {
  if (!code) return null;
  return COUNTRIES.find((c) => c.code === code.toLowerCase()) ?? null;
}

/** Hay un proveedor de proxies configurado. */
export function proxyConfigured(): boolean {
  return !!(process.env.ROBOTS_PROXY_URL ?? '').trim();
}

/** Países que se pueden elegir (todos, o los de ROBOTS_PROXY_COUNTRIES si hay proxy). */
export function availableCountries(): string[] {
  const all = COUNTRIES.map((c) => c.code);
  const raw = (process.env.ROBOTS_PROXY_COUNTRIES ?? '').trim().toLowerCase();
  if (!raw || !proxyConfigured()) return all;
  const allowed = new Set(raw.split(/[\s,]+/).filter(Boolean));
  return all.filter((c) => allowed.has(c));
}

/**
 * Proxy de una corrida: arma server / usuario / contraseña desde
 * ROBOTS_PROXY_URL con el país y una sesión nueva. null sin proveedor o si la
 * URL no es válida (la corrida sale sin proxy y el detalle lo dice).
 */
export function proxyFor(country: string | null, session: string = crypto.randomUUID().replace(/-/g, '').slice(0, 12)): {
  server: string;
  username?: string;
  password?: string;
} | null {
  const raw = (process.env.ROBOTS_PROXY_URL ?? '').trim();
  if (!raw) return null;
  // Sin país elegido: el marcador queda vacío o el proveedor elige ("-cc-" sin valor lo ignora la mayoría).
  const filled = raw.split('{country}').join(country ?? (process.env.ROBOTS_PROXY_DEFAULT_COUNTRY ?? 'us')).split('{session}').join(session);
  let u: URL;
  try {
    u = new URL(filled);
  } catch {
    return null;
  }
  if (!/^(http|https|socks5):$/.test(u.protocol)) return null;
  return {
    server: `${u.protocol}//${u.host}`,
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
  };
}

/** Opciones del arnés para el país elegido (idioma, zona horaria y proxy). */
export function geoOptions(country: string | undefined | null): {
  locale?: string;
  timezoneId?: string;
  proxy?: { server: string; username?: string; password?: string };
} {
  const info = countryInfo(country);
  const proxy = proxyFor(info?.code ?? null);
  return {
    ...(info ? { locale: info.locale, timezoneId: info.timezoneId } : {}),
    ...(proxy ? { proxy } : {}),
  };
}
