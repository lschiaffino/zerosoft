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

export function shortDomain(): string {
  return process.env.SHORT_DOMAIN ?? 'localhost:3000';
}

export function shortUrl(slug: string): string {
  const domain = shortDomain();
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
  return `https://${trimmed}`;
}
