/**
 * CRM — dominio de una empresa (puro: lo usan server y client).
 *
 * - normalizeCompanyDomain: "https://www.Acme.com/about" → "acme.com".
 * - parseSiteMeta: del HTML de la home saca nombre, teléfono e íconos para
 *   precargar una empresa nueva y buscar su logo (el favicon del sitio).
 * Sin APIs pagas de enrichment: solo lo que el sitio publica.
 */

/** Dominio limpio en minúsculas; '' si no parece un dominio público. */
export function normalizeCompanyDomain(raw: string | null | undefined): string {
  let v = (raw ?? '').trim().toLowerCase();
  if (!v) return '';
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\/\//, '');
  v = v.split(/[/?#]/)[0].replace(/^[^@]*@/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  v = v.replace(/^www\d?\./, '');
  if (v.length > 253) return '';
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/.test(v) ? v : '';
}

/** URL del logo servido por la app (cacheado server-side). */
export function companyLogoUrl(domain: string | null | undefined): string | null {
  const d = normalizeCompanyDomain(domain);
  return d ? `/api/crm/logo/${encodeURIComponent(d)}` : null;
}

/** Iniciales para el placeholder ("Acme Corp" → "AC"). */
export function companyInitials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const out = words.slice(0, 2).map((w) => Array.from(w)[0] ?? '').join('');
  return out.toUpperCase() || '?';
}

/** "acme-labs.com.ar" → "Acme Labs". */
export function nameFromDomain(domain: string): string {
  const d = normalizeCompanyDomain(domain);
  if (!d) return '';
  const parts = d.split('.');
  // Saca TLD y segundos niveles comunes (com.ar, co.uk, com.br).
  let i = parts.length - 1;
  if (i > 1 && /^(com|co|org|net|gov|edu|ac)$/.test(parts[i - 1])) i -= 1;
  const label = parts[Math.max(0, i - 1)];
  return label
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z#0-9]+);/gi, (m, k: string) => ENTITIES[k.toLowerCase()] ?? m);
}

function clean(s: string | undefined | null, max = 200): string {
  return decodeEntities(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Atributos de una etiqueta HTML (`<meta name="x" content="y">`). */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

/** "Acme | Software for teams" → "Acme" (el tramo más corto con letras). */
export function siteNameFromTitle(title: string): string {
  const parts = clean(title)
    .split(/\s+[|·•–—:-]\s+/)
    .map((p) => p.trim())
    .filter((p) => /\p{L}/u.test(p));
  if (!parts.length) return '';
  return parts.reduce((a, b) => (b.length < a.length ? b : a)).slice(0, 120);
}

export interface SiteMeta {
  name: string;
  description: string;
  phone: string;
  /** Candidatos a logo, del mejor al peor (absolutos). */
  icons: string[];
}

/** Lee lo básico de la home. `baseUrl` resuelve hrefs relativos. */
export function parseSiteMeta(html: string, baseUrl: string): SiteMeta {
  const head = html.slice(0, 300_000);
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const meta = (key: string) =>
    metas.find((a) => (a.property ?? a.name ?? '').toLowerCase() === key)?.content ?? '';
  const title = clean(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const siteName = clean(meta('og:site_name'), 120) || clean(meta('application-name'), 120);
  const name = siteName || siteNameFromTitle(title);
  const description = clean(meta('og:description') || meta('description'), 500);

  const abs = (href: string): string | null => {
    try {
      const u = new URL(decodeEntities(href.trim()), baseUrl);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
    } catch {
      return null;
    }
  };
  type Icon = { url: string; score: number };
  const icons: Icon[] = [];
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const rel = (a.rel ?? '').toLowerCase().split(/\s+/);
    if (!a.href || !(rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed'))) {
      continue;
    }
    const url = abs(a.href);
    if (!url || url.startsWith('data:')) continue;
    const size = Math.max(0, ...(a.sizes ?? '').split(/\s+/).map((s) => Number(s.split('x')[0]) || 0));
    // Más grande es mejor (hasta 256); los apple-touch suelen ser 180px y nítidos.
    let score = Math.min(size, 256) || (rel.includes('apple-touch-icon') ? 180 : 32);
    if (/\.svg(\?|$)/i.test(url) || a.type === 'image/svg+xml') score = Math.max(score, 120);
    icons.push({ url, score });
  }
  icons.sort((x, y) => y.score - x.score);
  const fallback = abs('/favicon.ico');
  const list = [...new Set([...icons.map((i) => i.url), ...(fallback ? [fallback] : [])])].slice(0, 5);

  const tel = head.match(/href\s*=\s*["']tel:([+\d][\d\s().-]{5,24})["']/i)?.[1] ?? html.match(/href\s*=\s*["']tel:([+\d][\d\s().-]{5,24})["']/i)?.[1] ?? '';
  return { name, description, phone: clean(tel, 40), icons: list };
}

/** Tipo de imagen por los primeros bytes (el content-type de los favicons miente seguido). */
export function sniffImageType(bytes: Uint8Array): string | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) return 'image/gif';
  if (b(0) === 0x00 && b(1) === 0x00 && (b(2) === 0x01 || b(2) === 0x02) && b(3) === 0x00) return 'image/x-icon';
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) {
    return 'image/webp';
  }
  const head = new TextDecoder().decode(bytes.slice(0, 1024)).trimStart().toLowerCase();
  if ((head.startsWith('<svg') || head.startsWith('<?xml')) && head.includes('<svg')) return 'image/svg+xml';
  return null;
}

/** Tope de tamaño de un logo cacheado. */
export const MAX_LOGO_BYTES = 200_000;
