/**
 * CRM — logos de empresas y datos básicos desde el dominio. Server-only.
 *
 * El logo es el favicon (o apple-touch-icon) que publica el sitio: se baja
 * server-side con safeFetch (solo hosts públicos, cada redirección validada,
 * timeout) y queda en crm_logo_cache por dominio, compartido entre
 * workspaces porque es público. Un dominio sin logo también se cachea
 * ('missing') para no reintentar en cada render.
 */
import { getDb } from './db';
import { safeFetch } from './safe-fetch';
import { MAX_LOGO_BYTES, nameFromDomain, normalizeCompanyDomain, parseSiteMeta, sniffImageType, type SiteMeta } from './crm-domain';

const OK_TTL_DAYS = 30;
const MISSING_TTL_DAYS = 7;
const UA = 'Mozilla/5.0 (compatible; ZerosoftBot/1.0; +https://zerosoft.ai)';

export interface CachedLogo {
  status: 'ok' | 'missing';
  contentType: string;
  data: Uint8Array | null;
}

/** Lee hasta `max` bytes del body (corta si el sitio manda más). */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Home del sitio: HTML (hasta 600 KB) y la URL final tras redirecciones. */
async function fetchHome(domain: string): Promise<{ html: string; url: string } | null> {
  for (const base of [`https://${domain}/`, `https://www.${domain}/`]) {
    try {
      const res = await safeFetch(base, { headers: { 'user-agent': UA, accept: 'text/html' } }, 6000, { maxRedirects: 4 });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        continue;
      }
      const bytes = await readCapped(res, 600_000);
      if (!bytes) continue;
      return { html: new TextDecoder().decode(bytes), url: res.url || base };
    } catch {
      // Sigue con la variante www (o no hay sitio).
    }
  }
  return null;
}

/** Datos básicos del sitio para precargar una empresa (nombre, teléfono). */
export async function fetchSiteInfo(rawDomain: string): Promise<(SiteMeta & { domain: string; website: string }) | null> {
  const domain = normalizeCompanyDomain(rawDomain);
  if (!domain) return null;
  const home = await fetchHome(domain);
  const meta = home ? parseSiteMeta(home.html, home.url) : { name: '', description: '', phone: '', icons: [] };
  return {
    ...meta,
    name: meta.name || nameFromDomain(domain),
    domain,
    website: `https://${domain}`,
  };
}

async function fetchImage(url: string): Promise<{ contentType: string; data: Uint8Array } | null> {
  try {
    const res = await safeFetch(url, { headers: { 'user-agent': UA, accept: 'image/*' } }, 5000, { maxRedirects: 3 });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const data = await readCapped(res, MAX_LOGO_BYTES);
    if (!data || data.byteLength < 16) return null;
    const contentType = sniffImageType(data);
    return contentType ? { contentType, data } : null;
  } catch {
    return null;
  }
}

/** Busca el logo del dominio en el sitio (sin cache). */
export async function discoverLogo(domain: string): Promise<{ contentType: string; data: Uint8Array } | null> {
  const home = await fetchHome(domain);
  const icons = home ? parseSiteMeta(home.html, home.url).icons : [`https://${domain}/favicon.ico`];
  for (const url of icons.slice(0, 4)) {
    const img = await fetchImage(url);
    if (img) return img;
  }
  return null;
}

function fresh(fetchedAt: string, status: 'ok' | 'missing', now: Date): boolean {
  const ts = new Date(`${fetchedAt.replace(' ', 'T')}Z`).getTime();
  const ttl = (status === 'ok' ? OK_TTL_DAYS : MISSING_TTL_DAYS) * 86_400_000;
  return Number.isFinite(ts) && now.getTime() - ts < ttl;
}

function toBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return null;
}

/** Logo cacheado del dominio; si no hay (o venció) lo busca y lo guarda. null = dominio inválido. */
export async function getCompanyLogo(
  rawDomain: string,
  opts: { now?: Date; discover?: (domain: string) => Promise<{ contentType: string; data: Uint8Array } | null> } = {},
): Promise<CachedLogo | null> {
  const domain = normalizeCompanyDomain(rawDomain);
  if (!domain) return null;
  const now = opts.now ?? new Date();
  const db = getDb();
  const row = (await db.prepare('SELECT * FROM crm_logo_cache WHERE domain = ?').get(domain)) as
    | { status: 'ok' | 'missing'; content_type: string; data: unknown; fetched_at: string }
    | undefined;
  if (row && fresh(row.fetched_at, row.status, now)) {
    return { status: row.status, contentType: row.content_type, data: row.status === 'ok' ? toBytes(row.data) : null };
  }
  const found = await (opts.discover ?? discoverLogo)(domain);
  const ts = now.toISOString().slice(0, 19).replace('T', ' ');
  await db
    .prepare(
      `INSERT INTO crm_logo_cache (domain, status, content_type, data, fetched_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET status = excluded.status, content_type = excluded.content_type,
         data = excluded.data, fetched_at = excluded.fetched_at`,
    )
    .run(domain, found ? 'ok' : 'missing', found?.contentType ?? '', found?.data ?? null, ts);
  return found ? { status: 'ok', contentType: found.contentType, data: found.data } : { status: 'missing', contentType: '', data: null };
}
