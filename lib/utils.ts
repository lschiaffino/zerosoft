export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function formatNumber(n: number, locale: string = 'en'): string {
  return new Intl.NumberFormat(locale).format(n);
}

export function formatDate(iso: string, locale: string = 'en'): string {
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

export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
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
