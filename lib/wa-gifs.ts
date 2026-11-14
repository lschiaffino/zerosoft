/**
 * Buscador de GIFs de la pestaña GIFs del panel de emojis (Lines e Inbox),
 * como el de WhatsApp: tendencias, búsqueda y mandar uno. WhatsApp manda un
 * GIF como un video MP4 con `gifPlayback` (se ve mudo, en loop y con la marca
 * GIF), así que acá se busca en GIPHY o Tenor y se baja el MP4 del elegido.
 *
 * Proveedor: GIPHY con GIPHY_API_KEY, si no Tenor (v2, de Google) con
 * TENOR_API_KEY; con las dos, GIF_PROVIDER=tenor elige Tenor. Sin ninguna, la
 * pestaña muestra que falta configurarlo. GROUPS_GIFS_FAKE=1 (fuera de
 * producción) usa GIFs de prueba sin red; la cookie wa_gifs_fake=off muestra
 * el estado sin clave.
 *
 * La clave nunca llega al navegador: las rutas de Lines e Inbox hacen de proxy
 * (lib/wa-gifs-http.ts). Server-only.
 */
import { safeFetch } from './safe-fetch';
import { FAKE_GIF_MP4, FAKE_GIF_PREVIEWS } from './wa-gif-fixtures';

export type GifProviderName = 'giphy' | 'tenor' | 'fake';

/** Un GIF del buscador: la vista previa (imagen animada chica) y el MP4 que se manda. */
export interface GifItem {
  id: string;
  title: string;
  /** Imagen animada chica para la grilla (GIF o WebP del CDN del proveedor). */
  preview: string;
  width: number;
  height: number;
  /** MP4 que se baja en el servidor y sale por WhatsApp. */
  mp4: string;
  /** Bytes del MP4, si el proveedor los dice. */
  size?: number;
}

export interface GifPage {
  provider: GifProviderName | null;
  items: GifItem[];
  /** Para pedir más (offset en GIPHY, `pos` en Tenor); vacío si no hay. */
  next: string;
}

export class GifError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

/** Lo más grande que se manda: el archivo va por el pedido al servidor de WhatsApp (Inbox lo manda en base64 hasta 4 MB). */
export const GIF_MAX_BYTES = 4 * 1024 * 1024;
/** Clasificación por defecto: GIPHY pg-13, Tenor "medium" (lo mismo en su escala). */
const GIPHY_RATING = 'pg-13';
const TENOR_FILTER = 'medium';
export const GIF_PAGE = 24;

/** El buscador falso: solo con la bandera y nunca en el deploy de producción. */
function fakeEnabled(): boolean {
  return process.env.GROUPS_GIFS_FAKE === '1' && process.env.VERCEL_ENV !== 'production';
}

/**
 * Qué buscador se usa: el falso si está la bandera (y no lo apagó la cookie
 * `wa_gifs_fake=off`, para ver el estado sin clave), si no GIPHY o Tenor según
 * la clave. null: no está configurado.
 */
export function gifProvider(opts: { fakeOff?: boolean } = {}): GifProviderName | null {
  if (fakeEnabled()) return opts.fakeOff ? null : 'fake';
  const giphy = Boolean(process.env.GIPHY_API_KEY?.trim());
  const tenor = Boolean(process.env.TENOR_API_KEY?.trim());
  if (giphy && tenor) return process.env.GIF_PROVIDER === 'tenor' ? 'tenor' : 'giphy';
  if (giphy) return 'giphy';
  if (tenor) return 'tenor';
  return null;
}

// ---------------------------------------------------------------------------
// Leer las respuestas
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const text = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const https = (v: unknown): string => {
  const s = text(v, 2000);
  return /^https:\/\//.test(s) ? s : '';
};

/**
 * Una respuesta de GIPHY (/v1/gifs/search o /trending) → GIFs. Vista previa:
 * fixed_width_downsampled (200 px de ancho, pocos cuadros; WebP si está).
 * MP4: el original si entra en GIF_MAX_BYTES, si no uno más chico.
 */
export function parseGiphy(raw: unknown): { items: GifItem[]; next: string } {
  const body = obj(raw);
  const data = Array.isArray(body.data) ? body.data : [];
  const items: GifItem[] = [];
  for (const d of data) {
    const g = obj(d);
    const images = obj(g.images);
    const pv = obj(images.fixed_width_downsampled);
    const pv2 = obj(images.fixed_width);
    const preview = https(pv.webp) || https(pv.url) || https(pv2.webp) || https(pv2.url);
    const width = int(pv.width) || int(pv2.width);
    const height = int(pv.height) || int(pv2.height);
    const orig = obj(images.original);
    const mp4s = [
      { url: https(obj(images.original_mp4).mp4), size: int(obj(images.original_mp4).mp4_size) },
      { url: https(orig.mp4), size: int(orig.mp4_size) },
      { url: https(obj(images.downsized_small).mp4), size: int(obj(images.downsized_small).mp4_size) },
      { url: https(obj(images.fixed_height).mp4), size: int(obj(images.fixed_height).mp4_size) },
    ].filter((m) => m.url);
    const mp4 = mp4s.find((m) => m.size && m.size <= GIF_MAX_BYTES) ?? mp4s.find((m) => !m.size);
    const id = text(g.id, 100);
    if (!id || !preview || !mp4 || !width || !height) continue;
    items.push({ id, title: text(g.title), preview, width, height, mp4: mp4.url, ...(mp4.size ? { size: mp4.size } : {}) });
  }
  const p = obj(body.pagination);
  const offset = int(p.offset) + int(p.count);
  const total = int(p.total_count);
  // GIPHY no da más allá de offset 4999.
  const next = data.length > 0 && offset < Math.min(total || offset + 1, 4999) ? String(offset) : '';
  return { items, next };
}

/**
 * Una respuesta de Tenor v2 (/v2/search o /featured) → GIFs. Vista previa:
 * tinygif (o nanogif); MP4: mp4 si entra, si no tinymp4.
 */
export function parseTenor(raw: unknown): { items: GifItem[]; next: string } {
  const body = obj(raw);
  const results = Array.isArray(body.results) ? body.results : [];
  const items: GifItem[] = [];
  for (const r of results) {
    const g = obj(r);
    const f = obj(g.media_formats);
    const pv = [obj(f.tinygif), obj(f.nanogif), obj(f.gif)].find((x) => https(x.url)) ?? {};
    const dims = Array.isArray(pv.dims) ? pv.dims : [];
    const mp4s = [obj(f.mp4), obj(f.loopedmp4), obj(f.tinymp4)].map((m) => ({ url: https(m.url), size: int(m.size) })).filter((m) => m.url);
    const mp4 = mp4s.find((m) => m.size && m.size <= GIF_MAX_BYTES) ?? mp4s.find((m) => !m.size);
    const id = text(g.id, 100);
    const width = int(dims[0]);
    const height = int(dims[1]);
    if (!id || !https(pv.url) || !mp4 || !width || !height) continue;
    items.push({
      id,
      title: text(g.content_description) || text(g.title),
      preview: https(pv.url),
      width,
      height,
      mp4: mp4.url,
      ...(mp4.size ? { size: mp4.size } : {}),
    });
  }
  return { items, next: results.length > 0 ? text(body.next, 100) : '' };
}

// ---------------------------------------------------------------------------
// Buscar (con caché corta)
// ---------------------------------------------------------------------------

/** Idioma de la búsqueda: GIPHY toma el código de dos letras; Tenor, un locale. */
export function providerLocale(provider: 'giphy' | 'tenor', locale: string): string {
  const lang = (locale || 'en').slice(0, 2).toLowerCase();
  const safe = /^[a-z]{2}$/.test(lang) ? lang : 'en';
  if (provider === 'giphy') return safe;
  return safe === 'pt' ? 'pt_BR' : safe === 'es' ? 'es' : safe === 'en' ? 'en_US' : safe;
}

/** URL del pedido al proveedor (con la clave: nunca sale del servidor). */
export function providerUrl(provider: 'giphy' | 'tenor', q: string, locale: string, pos: string, limit = GIF_PAGE): string {
  if (provider === 'giphy') {
    const u = new URL(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}`);
    u.searchParams.set('api_key', process.env.GIPHY_API_KEY?.trim() ?? '');
    if (q) u.searchParams.set('q', q);
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('offset', String(Math.min(4999, int(pos))));
    u.searchParams.set('rating', GIPHY_RATING);
    u.searchParams.set('lang', providerLocale('giphy', locale));
    u.searchParams.set('bundle', 'messaging_non_clips');
    return u.toString();
  }
  const u = new URL(`https://tenor.googleapis.com/v2/${q ? 'search' : 'featured'}`);
  u.searchParams.set('key', process.env.TENOR_API_KEY?.trim() ?? '');
  u.searchParams.set('client_key', 'zerosoft');
  if (q) u.searchParams.set('q', q);
  u.searchParams.set('limit', String(limit));
  if (pos) u.searchParams.set('pos', pos);
  u.searchParams.set('locale', providerLocale('tenor', locale));
  u.searchParams.set('contentfilter', TENOR_FILTER);
  u.searchParams.set('media_filter', 'tinygif,nanogif,mp4,loopedmp4,tinymp4');
  return u.toString();
}

/** El buscador falso: 24 GIFs de prueba por página, tres páginas; "nada" no encuentra nada. */
function fakePage(q: string, pos: string): { items: GifItem[]; next: string } {
  if (q.toLowerCase() === 'nada' || q.toLowerCase() === 'nothing') return { items: [], next: '' };
  const start = int(pos);
  const items = Array.from({ length: GIF_PAGE }, (_, i) => {
    const n = start + i;
    const [b64, width, height] = FAKE_GIF_PREVIEWS[n % FAKE_GIF_PREVIEWS.length];
    return { id: `fake-${q ? 'q' : 't'}-${n}`, title: q ? `${q} ${n + 1}` : `Trending ${n + 1}`, preview: `data:image/gif;base64,${b64}`, width, height, mp4: `fake:${n}`, size: FAKE_GIF_MP4.length };
  });
  return { items, next: start + GIF_PAGE < GIF_PAGE * 3 ? String(start + GIF_PAGE) : '' };
}

const cache = new Map<string, { at: number; page: { items: GifItem[]; next: string } }>();
/** Tendencias cambian poco; una búsqueda repetida (escribir y borrar) no vuelve a salir. */
const CACHE_MS = { trending: 10 * 60_000, search: 5 * 60_000 };
const CACHE_MAX = 300;

/** Vacía la caché (tests). */
export function clearGifCache(): void {
  cache.clear();
}

/**
 * Una página de tendencias (sin `q`) o de una búsqueda. Lo mismo dentro de
 * unos minutos sale de la caché (por proveedor, idioma, texto y página).
 */
export async function listGifs(opts: { q?: string; locale?: string; pos?: string; fakeOff?: boolean; fetcher?: typeof fetch }): Promise<GifPage> {
  const provider = gifProvider({ fakeOff: opts.fakeOff });
  if (!provider) return { provider: null, items: [], next: '' };
  const q = (opts.q ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
  const pos = (opts.pos ?? '').slice(0, 100);
  if (provider === 'fake') return { provider, ...fakePage(q, pos) };
  const locale = (opts.locale ?? 'en').slice(0, 10);
  const key = `${provider}|${providerLocale(provider, locale)}|${q.toLowerCase()}|${pos}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (q ? CACHE_MS.search : CACHE_MS.trending)) return { provider, ...hit.page };
  let res: Response;
  try {
    res = await (opts.fetcher ?? fetch)(providerUrl(provider, q, locale, pos), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  } catch {
    throw new GifError('gif_provider_error', 502);
  }
  if (res.status === 429) throw new GifError('rate_limited', 429);
  if (!res.ok) throw new GifError('gif_provider_error', 502);
  const json = (await res.json().catch(() => null)) as unknown;
  const page = provider === 'giphy' ? parseGiphy(json) : parseTenor(json);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), page });
  return { provider, ...page };
}

// ---------------------------------------------------------------------------
// Bajar el elegido
// ---------------------------------------------------------------------------

/** Solo se bajan MP4 del CDN del proveedor configurado (nada que mande el navegador a otro lado). */
export function isGifMediaUrl(provider: GifProviderName, raw: string): boolean {
  if (provider === 'fake') return /^fake:\d{1,4}$/.test(raw);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  if (provider === 'giphy') return /^(media\d?\.giphy\.com|i\.giphy\.com)$/.test(host);
  return /^(media\d?\.tenor\.com|c\.tenor\.com)$/.test(host);
}

/** MP4 de verdad: "ftyp" en el byte 4. */
export function looksLikeMp4(buf: Buffer): boolean {
  return buf.length > 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp';
}

/**
 * Baja el MP4 de un GIF elegido: solo del CDN del proveedor, con safeFetch y
 * el DNS fijado (sin rebinding hacia la red interna), hasta GIF_MAX_BYTES
 * (se corta leyendo, sin confiar en content-length) y solo si los bytes son
 * un MP4.
 */
export async function downloadGif(url: string, opts: { fakeOff?: boolean } = {}): Promise<Buffer> {
  const provider = gifProvider(opts);
  if (!provider) throw new GifError('gifs_not_configured', 409);
  if (!isGifMediaUrl(provider, url)) throw new GifError('invalid_gif', 400);
  if (provider === 'fake') return FAKE_GIF_MP4;
  let res: Response;
  try {
    res = await safeFetch(url, { headers: { accept: 'video/mp4' } }, 15_000, { maxRedirects: 2, pinDns: true });
  } catch {
    throw new GifError('gif_download_failed', 502);
  }
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!res.ok || !res.body || !/^(video\/mp4|application\/octet-stream|)$/.test(type)) {
    await res.body?.cancel().catch(() => null);
    throw new GifError('gif_download_failed', 502);
  }
  if (Number(res.headers.get('content-length') ?? 0) > GIF_MAX_BYTES) {
    await res.body.cancel().catch(() => null);
    throw new GifError('gif_too_large', 413);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > GIF_MAX_BYTES) {
      await reader.cancel().catch(() => null);
      throw new GifError('gif_too_large', 413);
    }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks);
  if (!looksLikeMp4(buf)) throw new GifError('gif_download_failed', 502);
  return buf;
}

/** Lo que manda el navegador al elegir un GIF: la URL del MP4 (se valida) y sus medidas (para la burbuja). */
export function gifChoice(b: Record<string, unknown>): { url: string; width?: number; height?: number } {
  const url = typeof b.url === 'string' ? b.url.slice(0, 2000) : '';
  if (!url) throw new GifError('invalid_gif', 400);
  const w = int(b.width);
  const h = int(b.height);
  return { url, ...(w && h && w <= 4000 && h <= 4000 ? { width: w, height: h } : {}) };
}
