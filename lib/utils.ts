export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function formatNumber(n: number, locale: string = 'en'): string {
  return new Intl.NumberFormat(locale).format(n);
}

/** Etiqueta de eje de un gráfico: sin decimales largos (33.333…) y compacta desde 10 mil (12K). */
export function formatAxis(n: number, locale: string = 'en'): string {
  const abs = Math.abs(n);
  return new Intl.NumberFormat(locale, {
    notation: abs >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: abs >= 10 || Number.isInteger(n) ? 0 : 1,
  }).format(n);
}

/** Fecha sin hora ('2026-03-15'): es un día del calendario, no un instante. */
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fecha legible. Las fechas sin hora (close date, vencimientos) se muestran
 * tal cual: leídas como medianoche UTC y mostradas en otra zona caían un día antes.
 */
export function formatDate(iso: string, locale: string = 'en'): string {
  if (DATE_ONLY.test(iso)) {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  }
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'));
}

export function formatDateTime(iso: string, locale: string = 'en'): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'));
}

export function shortDomain(): string {
  return process.env.SHORT_DOMAIN ?? 'localhost:3000';
}

export function shortUrl(slug: string, hostname: string | null = null): string {
  const domain = hostname ?? shortDomain();
  const proto = domain.includes('localhost') ? 'http' : 'https';
  return `${proto}://${domain}/${slug}`;
}

/**
 * Host que puede ser un destino real: dominio con TLD (example.com), localhost
 * o una IP. "x" o "promo" solos no son destinos.
 */
export function hasRoutableHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h.startsWith('[') && h.endsWith(']')) return true;
  return /^([a-z0-9-]+\.)+([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(h);
}

export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && hasRoutableHost(u.hostname);
  } catch {
    return false;
  }
}

export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Otro esquema explícito (ftp://, javascript:, data:…): se deja tal cual para
  // que isValidUrl lo rechace, en vez de convertirlo en https://ftp://…
  if (/^[a-z][a-z0-9+.-]*:(\/\/|[^0-9])/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Fecha relativa localizada ("in 3 days", "ayer") via Intl.RelativeTimeFormat. */
export function relDate(iso: string, locale: string = 'en'): string {
  const ms = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(ms)) return '';
  const diff = ms - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const mins = Math.round(diff / 60_000);
  if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rtf.format(days, 'day');
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return rtf.format(months, 'month');
  return rtf.format(Math.round(months / 12), 'year');
}
