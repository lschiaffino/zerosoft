/**
 * Docs D5: el sitio publicado del workspace (centro de ayuda en /h/<handle>)
 * como sitio propio, y las vistas de páginas.
 *
 * - Ajustes del sitio (docs_sites): indexación en buscadores, idioma del
 *   dominio propio y el dominio (uno por workspace, como Notion Sites).
 * - Dominio propio: mismo flujo que los dominios de Link (lib/link-domains.ts):
 *   en Vercel se agrega al proyecto por API (VERCEL_TOKEN + VERCEL_PROJECT_ID)
 *   y la propiedad se prueba con un TXT _zerosoft-verify.<host>. Un hostname
 *   no puede ser a la vez de Link y del sitio. El middleware pregunta por el
 *   host (/api/docs/site/host) y reescribe a /<locale>/h/<handle>/….
 * - Analítica del sitio (docs_site_views): una fila por visitante, página y
 *   día. El visitante es un hash de IP + navegador + día con el secreto del
 *   servidor: sin cookies ni IP guardada. Los bots no cuentan.
 * - Vistas internas (docs_page_views): quién abrió cada página del
 *   workspace, por día (como "Updates & analytics" de Notion).
 *
 * DOCS_DOMAIN_FAKE=1 (tests): un dominio .test se verifica sin DNS.
 */
import { createHash } from 'crypto';
import { getDb } from './db';
import { isAppHost, isValidHostname, normalizeHost } from './hosts';
import {
  dnsInstructions,
  claimDns,
  claimToken,
  hasOwnershipTxt,
  provesClaim,
  purgeExpiredLinkPending,
  routingReady,
  UNVERIFIED_TTL_DAYS,
  vercel,
  vercelConfigured,
  vercelQuery,
  type DnsInstruction,
} from './link-domains';
import { isBotRequest } from './track';

export interface DocsSite {
  indexing: boolean;
  locale: 'en' | 'es' | 'pt' | null;
  hostname: string | null;
  verified: boolean;
  verified_at: string | null;
  dns: DnsInstruction[];
}

interface SiteRow {
  workspace_id: string;
  indexing: number;
  locale: string | null;
  hostname: string | null;
  verified: number;
  verified_at: string | null;
  verify_token: string | null;
}

const LOCALES = new Set(['en', 'es', 'pt']);

function fakeDomains(): boolean {
  return process.env.DOCS_DOMAIN_FAKE === '1';
}

async function siteRow(workspaceId: string): Promise<SiteRow | null> {
  return ((await getDb().prepare('SELECT * FROM docs_sites WHERE workspace_id = ?').get(workspaceId)) as SiteRow | undefined) ?? null;
}

function toSite(row: SiteRow | null): DocsSite {
  return {
    indexing: row ? row.indexing !== 0 : true,
    locale: row?.locale && LOCALES.has(row.locale) ? (row.locale as DocsSite['locale']) : null,
    hostname: row?.hostname ?? null,
    verified: row?.verified === 1,
    verified_at: row?.verified_at ?? null,
    dns: row?.hostname && row.verified !== 1 ? dnsInstructions(row.hostname, row.verify_token) : [],
  };
}

export async function getDocsSite(workspaceId: string): Promise<DocsSite> {
  return toSite(await siteRow(workspaceId));
}

async function ensureRow(workspaceId: string): Promise<void> {
  await getDb().prepare('INSERT OR IGNORE INTO docs_sites (workspace_id) VALUES (?)').run(workspaceId);
}

export async function updateDocsSite(workspaceId: string, patch: { indexing?: boolean; locale?: string | null }): Promise<DocsSite> {
  await ensureRow(workspaceId);
  if (patch.indexing !== undefined) {
    await getDb().prepare("UPDATE docs_sites SET indexing = ?, updated_at = datetime('now') WHERE workspace_id = ?").run(patch.indexing ? 1 : 0, workspaceId);
  }
  if (patch.locale !== undefined) {
    const locale = patch.locale && LOCALES.has(patch.locale) ? patch.locale : null;
    await getDb().prepare("UPDATE docs_sites SET locale = ?, updated_at = datetime('now') WHERE workspace_id = ?").run(locale, workspaceId);
  }
  return getDocsSite(workspaceId);
}

// ---------- Dominio propio ----------

export type SiteDomainError = 'invalid_hostname' | 'domain_taken' | 'app_host' | 'provider_error' | 'domain_exists' | 'domain_pending_elsewhere';

function cleanHostname(raw: string): string {
  return normalizeHost(raw.trim()).replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
}

export { claimToken };

async function vercelRemove(hostname: string): Promise<void> {
  if (vercelConfigured() && !fakeDomains()) {
    await vercel(`/v9/projects/${process.env.VERCEL_PROJECT_ID}/domains/${encodeURIComponent(hostname)}${vercelQuery()}`, { method: 'DELETE' });
  }
}

/**
 * Libera los dominios sin verificar vencidos (UNVERIFIED_TTL_DAYS, como Link):
 * un alta que nunca se verificó no ocupa el hostname para siempre.
 */
export async function purgeExpiredSiteDomains(hostname?: string): Promise<number> {
  const rows = (await getDb()
    .prepare(
      `SELECT workspace_id, hostname FROM docs_sites
       WHERE hostname IS NOT NULL AND verified = 0 AND domain_added_at < datetime('now', ?)${hostname ? ' AND hostname = ?' : ''}`,
    )
    .all(`-${UNVERIFIED_TTL_DAYS} days`, ...(hostname ? [hostname] : []))) as Array<{ workspace_id: string; hostname: string }>;
  for (const r of rows) {
    // Si Link lo tomó mientras tanto, no se saca del proyecto.
    const link = await getDb().prepare('SELECT 1 AS x FROM link_domains WHERE hostname = ?').get(r.hostname);
    if (!link) await vercelRemove(r.hostname);
    await getDb()
      .prepare("UPDATE docs_sites SET hostname = NULL, verify_token = NULL, domain_added_at = NULL, updated_at = datetime('now') WHERE workspace_id = ? AND verified = 0")
      .run(r.workspace_id);
  }
  return rows.length;
}

export async function addSiteDomain(
  workspaceId: string,
  raw: string,
): Promise<{ ok: true; site: DocsSite } | { ok: false; code: SiteDomainError; dns?: DnsInstruction[] }> {
  const hostname = cleanHostname(raw);
  if (!isValidHostname(hostname)) return { ok: false, code: 'invalid_hostname' };
  if (isAppHost(hostname)) return { ok: false, code: 'app_host' };
  const current = await siteRow(workspaceId);
  if (current?.hostname) return { ok: false, code: 'domain_exists' };
  const db = getDb();
  await purgeExpiredSiteDomains(hostname);
  // Link: verificado no se comparte; pendiente vencido se libera; pendiente vigente de otro se toma probando el TXT.
  await purgeExpiredLinkPending(hostname);
  const link = (await db.prepare('SELECT id, user_id, verified FROM link_domains WHERE hostname = ?').get(hostname)) as
    | { id: string; user_id: string; verified: number }
    | undefined;
  if (link?.verified === 1) return { ok: false, code: 'domain_taken' };
  const token = claimToken(workspaceId, hostname);
  if (link) {
    if (link.user_id !== workspaceId && !(await provesClaim(workspaceId, hostname))) {
      return { ok: false, code: 'domain_pending_elsewhere', dns: claimDns(workspaceId, hostname) };
    }
    await db.prepare('DELETE FROM link_domains WHERE id = ? AND verified = 0').run(link.id);
  }
  const holder = (await db.prepare('SELECT workspace_id, verified FROM docs_sites WHERE hostname = ?').get(hostname)) as
    | { workspace_id: string; verified: number }
    | undefined;
  if (holder) {
    if (holder.verified === 1) return { ok: false, code: 'domain_taken' };
    // Otro workspace lo agregó y no lo verificó: se lo queda quien prueba que es
    // suyo con el TXT de su token (lo devuelve este mismo error).
    if (!(await provesClaim(workspaceId, hostname))) return { ok: false, code: 'domain_pending_elsewhere', dns: claimDns(workspaceId, hostname) };
    await db
      .prepare("UPDATE docs_sites SET hostname = NULL, verify_token = NULL, domain_added_at = NULL, updated_at = datetime('now') WHERE workspace_id = ? AND verified = 0")
      .run(holder.workspace_id);
  }
  if (vercelConfigured() && !fakeDomains() && !holder && !link) {
    const res = await vercel(`/v10/projects/${process.env.VERCEL_PROJECT_ID}/domains${vercelQuery()}`, {
      method: 'POST',
      body: JSON.stringify({ name: hostname }),
    });
    if (!res) return { ok: false, code: 'provider_error' };
    if (!res.ok) {
      if (res.status !== 409) return { ok: false, code: 'provider_error' };
      // 409: solo vale si ya está en nuestro proyecto (un reintento).
      const mine = await vercel(`/v9/projects/${process.env.VERCEL_PROJECT_ID}/domains/${encodeURIComponent(hostname)}${vercelQuery()}`);
      if (!mine?.ok) return { ok: false, code: 'provider_error' };
    }
  }
  await ensureRow(workspaceId);
  try {
    await db
      .prepare(
        "UPDATE docs_sites SET hostname = ?, verified = 0, verified_at = NULL, verify_token = ?, domain_added_at = datetime('now'), updated_at = datetime('now') WHERE workspace_id = ?",
      )
      .run(hostname, token, workspaceId);
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(String(e))) return { ok: false, code: 'domain_taken' };
    throw e;
  }
  return { ok: true, site: await getDocsSite(workspaceId) };
}

export async function verifySiteDomain(workspaceId: string): Promise<{ verified: boolean; reason?: 'not_found' | 'txt_missing' | 'dns_not_ready' | 'domain_taken' }> {
  const row = await siteRow(workspaceId);
  if (!row?.hostname || !row.verify_token) return { verified: false, reason: 'not_found' };
  if (row.verified === 1) return { verified: true };
  // Link lo tomó mientras estaba pendiente.
  if (await getDb().prepare('SELECT 1 AS x FROM link_domains WHERE hostname = ?').get(row.hostname)) return { verified: false, reason: 'domain_taken' };
  const fake = fakeDomains() && row.hostname.endsWith('.test');
  if (!fake) {
    if (!(await hasOwnershipTxt(row.hostname, row.verify_token))) return { verified: false, reason: 'txt_missing' };
    if (!(await routingReady(row.hostname))) return { verified: false, reason: 'dns_not_ready' };
  }
  await getDb()
    .prepare("UPDATE docs_sites SET verified = 1, verified_at = ?, updated_at = datetime('now') WHERE workspace_id = ? AND hostname = ?")
    .run(new Date().toISOString(), workspaceId, row.hostname);
  return { verified: true };
}

export async function removeSiteDomain(workspaceId: string): Promise<boolean> {
  const row = await siteRow(workspaceId);
  if (!row?.hostname) return false;
  await vercelRemove(row.hostname);
  await getDb()
    .prepare("UPDATE docs_sites SET hostname = NULL, verified = 0, verified_at = NULL, verify_token = NULL, domain_added_at = NULL, updated_at = datetime('now') WHERE workspace_id = ?")
    .run(workspaceId);
  return true;
}

export interface SiteForHost {
  workspaceId: string;
  handle: string;
  locale: 'en' | 'es' | 'pt' | null;
}

/** Sitio servido por un dominio propio verificado (para el middleware). */
export async function siteForHost(rawHost: string): Promise<SiteForHost | null> {
  const host = normalizeHost(rawHost).replace(/:\d+$/, '');
  if (!host || !isValidHostname(host)) return null;
  const row = (await getDb()
    .prepare(
      `SELECT s.workspace_id, s.locale, u.handle FROM docs_sites s JOIN users u ON u.id = s.workspace_id
       WHERE s.hostname = ? AND s.verified = 1 AND u.handle IS NOT NULL`,
    )
    .get(host)) as { workspace_id: string; locale: string | null; handle: string } | undefined;
  if (!row) return null;
  return { workspaceId: row.workspace_id, handle: row.handle, locale: row.locale && LOCALES.has(row.locale) ? (row.locale as SiteForHost['locale']) : null };
}

/** Dominio verificado del sitio de un workspace (para links canónicos y el sitemap). */
export async function verifiedSiteHost(workspaceId: string): Promise<string | null> {
  const row = await siteRow(workspaceId);
  return row?.hostname && row.verified === 1 ? row.hostname : null;
}

/** URLs del sitio en su dominio propio (portada y páginas publicadas que se indexan). */
export async function siteSitemap(workspaceId: string, origin: string): Promise<Array<{ url: string; lastModified: Date }>> {
  const site = await getDocsSite(workspaceId);
  if (!site.indexing) return [];
  const rows = (await getDb()
    .prepare('SELECT slug, updated_at FROM docs_pages WHERE user_id = ? AND published = 1 AND archived = 0 AND seo_noindex = 0 AND slug IS NOT NULL ORDER BY updated_at DESC LIMIT 5000')
    .all(workspaceId)) as Array<{ slug: string; updated_at: string }>;
  const date = (v: string) => {
    const d = new Date(v.includes('T') ? v : `${v.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  };
  return [{ url: `${origin}/`, lastModified: rows[0] ? date(rows[0].updated_at) : new Date() }, ...rows.map((r) => ({ url: `${origin}/${r.slug}`, lastModified: date(r.updated_at) }))];
}

// ---------- Analítica del sitio ----------

export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Hash del visitante (IP + navegador + día + secreto): cambia cada día, no se puede revertir. */
export function visitorHash(ip: string, ua: string, day: string): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? 'zerosoft-docs-site';
  return createHash('sha256').update(`${secret}|docs-site|${day}|${ip}|${ua}`).digest('hex').slice(0, 32);
}

/** Host del referer si es de otro sitio (las navegaciones internas no cuentan como fuente). */
export function referrerHost(referer: string | null, ownHosts: string[]): string | null {
  if (!referer) return null;
  try {
    const host = new URL(referer).host.toLowerCase().replace(/^www\./, '');
    if (!host || ownHosts.some((h) => h.replace(/^www\./, '') === host)) return null;
    return host.slice(0, 120);
  } catch {
    return null;
  }
}

/**
 * Suma una vista de una página publicada (o '' = la portada del sitio). Solo
 * páginas publicadas del workspace; los bots no cuentan.
 */
export async function recordSiteView(input: {
  workspaceId: string;
  pageId: string;
  headers: Headers;
  ip: string | null;
  /** document.referrer de la visita (lo manda el navegador en el beacon). */
  referrer: string | null;
  ownHosts: string[];
}): Promise<boolean> {
  if (isBotRequest(input.headers, 'POST')) return false;
  const db = getDb();
  if (input.pageId) {
    const ok = await db
      .prepare('SELECT 1 AS x FROM docs_pages WHERE id = ? AND user_id = ? AND published = 1 AND archived = 0')
      .get(input.pageId, input.workspaceId);
    if (!ok) return false;
  }
  const day = utcDay();
  // Por IP y día: cambiar de navegador (user agent) no suma visitantes ni vistas sin tope.
  const visitor = visitorHash(input.ip ?? '', '', day);
  const ref = referrerHost(input.referrer, input.ownHosts);
  await db
    .prepare(
      `INSERT INTO docs_site_views (workspace_id, page_id, day, visitor, views, referrer) VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(workspace_id, page_id, day, visitor) DO UPDATE SET views = MIN(views + 1, 50)`,
    )
    .run(input.workspaceId, input.pageId, day, visitor, ref);
  return true;
}

export interface DayCount {
  day: string;
  views: number;
  visitors: number;
}

export interface SiteAnalytics {
  days: number;
  views: number;
  visitors: number;
  series: DayCount[];
  pages: Array<{ id: string; title: string; slug: string | null; views: number; visitors: number; helpful: number; notHelpful: number }>;
  referrers: Array<{ host: string; visitors: number }>;
}

/** Los últimos `days` días (UTC), del más viejo al de hoy. */
export function lastDays(days: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(utcDay(new Date(now.getTime() - i * 86_400_000)));
  return out;
}

export async function siteAnalytics(workspaceId: string, days = 30): Promise<SiteAnalytics> {
  const span = lastDays(days);
  const since = span[0];
  const db = getDb();
  const byDay = (await db
    .prepare(
      `SELECT day, SUM(views) AS views, COUNT(DISTINCT visitor) AS visitors FROM docs_site_views
       WHERE workspace_id = ? AND day >= ? GROUP BY day`,
    )
    .all(workspaceId, since)) as Array<{ day: string; views: number; visitors: number }>;
  const total = (await db
    .prepare('SELECT COALESCE(SUM(views), 0) AS views, COUNT(DISTINCT visitor) AS visitors FROM docs_site_views WHERE workspace_id = ? AND day >= ?')
    .get(workspaceId, since)) as { views: number; visitors: number };
  const pages = (await db
    .prepare(
      `SELECT v.page_id AS id, p.title, p.slug, SUM(v.views) AS views, COUNT(DISTINCT v.visitor || v.day) AS visitors,
        (SELECT COUNT(*) FROM docs_feedback f WHERE f.page_id = v.page_id AND f.helpful = 1) AS helpful,
        (SELECT COUNT(*) FROM docs_feedback f WHERE f.page_id = v.page_id AND f.helpful = 0) AS notHelpful
       FROM docs_site_views v JOIN docs_pages p ON p.id = v.page_id
       WHERE v.workspace_id = ? AND v.day >= ? AND v.page_id != '' AND p.published = 1
       GROUP BY v.page_id ORDER BY views DESC LIMIT 20`,
    )
    .all(workspaceId, since)) as SiteAnalytics['pages'];
  const referrers = (await db
    .prepare(
      `SELECT referrer AS host, COUNT(*) AS visitors FROM docs_site_views
       WHERE workspace_id = ? AND day >= ? AND referrer IS NOT NULL GROUP BY referrer ORDER BY visitors DESC LIMIT 10`,
    )
    .all(workspaceId, since)) as SiteAnalytics['referrers'];
  const map = new Map(byDay.map((r) => [r.day, r]));
  return {
    days,
    views: Number(total?.views ?? 0),
    visitors: Number(total?.visitors ?? 0),
    series: span.map((day) => ({ day, views: Number(map.get(day)?.views ?? 0), visitors: Number(map.get(day)?.visitors ?? 0) })),
    pages: pages.map((p) => ({ ...p, views: Number(p.views), visitors: Number(p.visitors), helpful: Number(p.helpful), notHelpful: Number(p.notHelpful) })),
    referrers: referrers.map((r) => ({ host: r.host, visitors: Number(r.visitors) })),
  };
}

// ---------- Vistas dentro del workspace ----------

/** Suma la vista de `viewerId` (persona real) a la página. */
export async function recordPageView(pageId: string, viewerId: string): Promise<void> {
  const now = new Date().toISOString();
  await getDb()
    .prepare(
      `INSERT INTO docs_page_views (page_id, viewer_id, day, views, last_at) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(page_id, viewer_id, day) DO UPDATE SET views = MIN(views + 1, 1000), last_at = excluded.last_at`,
    )
    .run(pageId, viewerId, utcDay(), now);
}

export interface PageAnalytics {
  days: number;
  views: number;
  viewers: number;
  series: DayCount[];
  /** Nombre (nunca el email: también lo ven invitados con edición). */
  people: Array<{ id: string; name: string | null; views: number; last_at: string }>;
  /** Vistas en el sitio publicado en el mismo período (si está publicada). */
  site: { views: number; visitors: number } | null;
}

export async function pageAnalytics(pageId: string, opts: { days?: number; published?: boolean; workspaceId?: string } = {}): Promise<PageAnalytics> {
  const days = opts.days ?? 30;
  const span = lastDays(days);
  const since = span[0];
  const db = getDb();
  const byDay = (await db
    .prepare('SELECT day, SUM(views) AS views, COUNT(*) AS visitors FROM docs_page_views WHERE page_id = ? AND day >= ? GROUP BY day')
    .all(pageId, since)) as Array<{ day: string; views: number; visitors: number }>;
  const total = (await db
    .prepare('SELECT COALESCE(SUM(views), 0) AS views, COUNT(DISTINCT viewer_id) AS viewers FROM docs_page_views WHERE page_id = ? AND day >= ?')
    .get(pageId, since)) as { views: number; viewers: number };
  const people = (await db
    .prepare(
      `SELECT v.viewer_id AS id, u.name, SUM(v.views) AS views, MAX(v.last_at) AS last_at
       FROM docs_page_views v LEFT JOIN users u ON u.id = v.viewer_id
       WHERE v.page_id = ? AND v.day >= ? GROUP BY v.viewer_id ORDER BY last_at DESC LIMIT 50`,
    )
    .all(pageId, since)) as PageAnalytics['people'];
  let site: PageAnalytics['site'] = null;
  if (opts.published && opts.workspaceId) {
    const s = (await db
      .prepare('SELECT COALESCE(SUM(views), 0) AS views, COUNT(DISTINCT visitor || day) AS visitors FROM docs_site_views WHERE workspace_id = ? AND page_id = ? AND day >= ?')
      .get(opts.workspaceId, pageId, since)) as { views: number; visitors: number };
    site = { views: Number(s?.views ?? 0), visitors: Number(s?.visitors ?? 0) };
  }
  const map = new Map(byDay.map((r) => [r.day, r]));
  return {
    days,
    views: Number(total?.views ?? 0),
    viewers: Number(total?.viewers ?? 0),
    series: span.map((day) => ({ day, views: Number(map.get(day)?.views ?? 0), visitors: Number(map.get(day)?.visitors ?? 0) })),
    people: people.map((p) => ({ ...p, views: Number(p.views) })),
    site,
  };
}

// ---------- SEO y plantilla de una página publicada ----------

export interface PagePublishSettings {
  allow_duplicate: boolean;
  seo_description: string | null;
  seo_noindex: boolean;
}

export async function getPagePublishSettings(pageId: string): Promise<PagePublishSettings | null> {
  const row = (await getDb().prepare('SELECT allow_duplicate, seo_description, seo_noindex FROM docs_pages WHERE id = ?').get(pageId)) as
    | { allow_duplicate: number; seo_description: string | null; seo_noindex: number }
    | undefined;
  if (!row) return null;
  return { allow_duplicate: row.allow_duplicate === 1, seo_description: row.seo_description ?? null, seo_noindex: row.seo_noindex === 1 };
}

export async function updatePagePublishSettings(pageId: string, patch: Partial<PagePublishSettings>): Promise<PagePublishSettings | null> {
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  if (patch.allow_duplicate !== undefined) {
    sets.push('allow_duplicate = ?');
    args.push(patch.allow_duplicate ? 1 : 0);
  }
  if (patch.seo_noindex !== undefined) {
    sets.push('seo_noindex = ?');
    args.push(patch.seo_noindex ? 1 : 0);
  }
  if (patch.seo_description !== undefined) {
    sets.push('seo_description = ?');
    const d = (patch.seo_description ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    args.push(d || null);
  }
  if (sets.length) await getDb().prepare(`UPDATE docs_pages SET ${sets.join(', ')} WHERE id = ?`).run(...args, pageId);
  return getPagePublishSettings(pageId);
}
