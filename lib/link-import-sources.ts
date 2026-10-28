/**
 * Importar desde Rebrandly y Short.io por API (como las migraciones de Dub).
 * El token se usa una vez y no se guarda. Cada link vuelve como ImportItem y
 * entra por importLinks (lib/bitly-import.ts): conserva el back-half y el
 * dominio propio si ya está verificado acá. LINK_IMPORT_FAKE=1 (tests) no
 * sale a internet y devuelve links de prueba. Server-only.
 */
import { MAX_IMPORT, type ImportItem } from './bitly-import';

export const IMPORT_SOURCES = ['bitly', 'rebrandly', 'shortio'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

function fake(): boolean {
  return process.env.LINK_IMPORT_FAKE === '1' && process.env.VERCEL_ENV !== 'production';
}

/** Links de prueba del modo fake (dominios que no existen: quedan en el dominio por defecto). */
function fakeItems(source: 'rebrandly' | 'shortio', token: string): ImportItem[] {
  if (token === 'bad') throw new Error(`${source}_unauthorized`);
  const host = source === 'rebrandly' ? 'rebrand.ly' : 'short.gy';
  const tag = source === 'rebrandly' ? 'from-rebrandly' : 'from-shortio';
  return [1, 2, 3].map((n) => ({
    shortUrl: `https://${host}/${source}-${token.slice(0, 6)}-${n}`,
    url: `https://example.com/${source}/${n}`,
    title: `${source} ${n}`,
    tags: [tag],
  }));
}

async function getJson<T>(url: string, headers: Record<string, string>, source: string): Promise<T> {
  // Hosts fijos de cada proveedor (no son URLs del usuario).
  const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401 || res.status === 403) throw new Error(`${source}_unauthorized`);
  if (!res.ok) throw new Error(`${source}_error`);
  return (await res.json()) as T;
}

interface RebrandlyLink {
  id: string;
  title?: string | null;
  slashtag?: string;
  destination?: string;
  shortUrl?: string;
  domain?: { fullName?: string };
}

/** Todos los links de la cuenta de Rebrandly (API key), de a 25 (el máximo de su API). */
export async function fetchRebrandlyLinks(apiKey: string): Promise<ImportItem[]> {
  if (fake()) return fakeItems('rebrandly', apiKey);
  const items: ImportItem[] = [];
  let last: string | null = null;
  for (let guard = 0; guard < 200 && items.length <= MAX_IMPORT; guard++) {
    const url: string = `https://api.rebrandly.com/v1/links?limit=25&orderBy=createdAt&orderDir=desc${last ? `&last=${encodeURIComponent(last)}` : ''}`;
    const page: RebrandlyLink[] = await getJson<RebrandlyLink[]>(url, { apikey: apiKey }, 'rebrandly');
    if (!Array.isArray(page) || page.length === 0) break;
    for (const l of page) {
      if (!l.destination) continue;
      const host = l.domain?.fullName ?? 'rebrand.ly';
      items.push({ shortUrl: l.shortUrl ? `https://${l.shortUrl.replace(/^https?:\/\//, '')}` : `https://${host}/${l.slashtag ?? ''}`, url: l.destination, title: l.title ?? null, tags: [] });
    }
    if (page.length < 25) break;
    last = page[page.length - 1].id;
  }
  return items;
}

interface ShortioDomain {
  id: number;
  hostname: string;
}
interface ShortioLink {
  originalURL?: string;
  path?: string;
  shortURL?: string;
  title?: string | null;
  tags?: string[];
}

/** Todos los links de todos los dominios de Short.io (secret key de la API). */
export async function fetchShortioLinks(secretKey: string): Promise<ImportItem[]> {
  if (fake()) return fakeItems('shortio', secretKey);
  const auth = { authorization: secretKey };
  const domains = await getJson<ShortioDomain[]>('https://api.short.io/api/domains', auth, 'shortio');
  const items: ImportItem[] = [];
  for (const d of Array.isArray(domains) ? domains : []) {
    let token: string | null = null;
    for (let guard = 0; guard < 200 && items.length <= MAX_IMPORT; guard++) {
      const url: string = `https://api.short.io/api/links?domain_id=${encodeURIComponent(String(d.id))}&limit=150${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
      const page: { links?: ShortioLink[]; nextPageToken?: string | null } = await getJson<{ links?: ShortioLink[]; nextPageToken?: string | null }>(url, auth, 'shortio');
      for (const l of page.links ?? []) {
        if (!l.originalURL) continue;
        items.push({
          shortUrl: l.shortURL ?? `https://${d.hostname}/${l.path ?? ''}`,
          url: l.originalURL,
          title: l.title ?? null,
          tags: Array.isArray(l.tags) ? l.tags.filter((t: unknown): t is string => typeof t === 'string') : [],
        });
      }
      token = page.nextPageToken ?? null;
      if (!token) break;
    }
  }
  return items;
}
