import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;
import { customAlphabet } from 'nanoid';
import { z } from 'zod';
import { getDb, type LinkRow } from './db';
import { isValidSlug, SLUG_REGEX } from './reserved';
import { isValidUrl, normalizeUrl, shortDomain, shortUrl } from './utils';
import { appHosts, isAppHost, isOwnDeploymentHost, normalizeHost } from './hosts';
import { getVerifiedDomainByHost } from './link-domains';
import { emitEvent } from './events';
import type { BulkResultItem } from './link-bulk-csv';
import {
  linkTargetingSchema,
  normalizeTargeting,
  parseTargeting,
  targetingDestinations,
  type LinkTargeting,
  type LinkTargetingInput,
} from './link-targeting';
import { syncUtm } from './link-url';

/** LinkRow + el hostname de su dominio propio (null = dominio por defecto). */
export type LinkWithDomain = LinkRow & { domain_hostname?: string | null };

const LINK_SELECT = 'SELECT l.*, d.hostname AS domain_hostname FROM links l LEFT JOIN link_domains d ON d.id = l.domain_id';

// ---------- Slugs ----------

const nanoSlug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 7);

/** El slug ya existe en ese dominio (null = dominio por defecto). */
export async function slugExists(slug: string, domainId: string | null = null): Promise<boolean> {
  return !!(await getDb()
    .prepare("SELECT 1 AS x FROM links WHERE slug = ? AND COALESCE(domain_id, '') = ?")
    .get(slug, domainId ?? ''));
}

/** Random 7-char lowercase alphanumeric slug, regenerated on collision. */
export async function generateSlug(domainId: string | null = null): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const candidate = nanoSlug();
    if (isValidSlug(candidate) && !(await slugExists(candidate, domainId))) return candidate;
  }
  // Practically unreachable; fall back to a longer id.
  return customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10)();
}

// ---------- Tags ----------

export function parseTags(json: string | null): string[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

// ---------- Reads ----------

export async function getLinkBySlug(slug: string, domainId: string | null = null): Promise<LinkWithDomain | undefined> {
  return (await getDb()
    .prepare(`${LINK_SELECT} WHERE l.slug = ? AND COALESCE(l.domain_id, '') = ?`)
    .get(slug, domainId ?? '')) as LinkWithDomain | undefined;
}

/**
 * Link servido en `host`: en el host de la app, el dominio por defecto; en un
 * dominio propio verificado, ese dominio. Hosts desconocidos no resuelven nada.
 */
export async function getLinkForHost(host: string | null, slug: string): Promise<LinkWithDomain | undefined> {
  if (isAppHost(host)) return getLinkBySlug(slug, null);
  const domain = await getVerifiedDomainByHost(host ?? '');
  return domain ? getLinkBySlug(slug, domain.id) : undefined;
}

export async function getUserLink(userId: string, id: string): Promise<LinkWithDomain | undefined> {
  return (await getDb()
    .prepare(`${LINK_SELECT} WHERE l.id = ? AND l.user_id = ?`)
    .get(id, userId)) as LinkWithDomain | undefined;
}

export async function getUserLinkByExternalId(userId: string, externalId: string): Promise<LinkWithDomain | undefined> {
  return (await getDb()
    .prepare(`${LINK_SELECT} WHERE l.user_id = ? AND l.external_id = ?`)
    .get(userId, externalId)) as LinkWithDomain | undefined;
}

/** Link por id o, con el prefijo ext_, por id externo (API v1, como Dub). */
export async function getUserLinkByRef(userId: string, ref: string): Promise<LinkWithDomain | undefined> {
  if (ref.startsWith('ext_')) return getUserLinkByExternalId(userId, ref.slice(4));
  return getUserLink(userId, ref);
}

/** URL corta de un link, en su dominio propio si tiene. */
export function linkShortUrl(link: Pick<LinkWithDomain, 'slug' | 'domain_hostname'>): string {
  return shortUrl(link.slug, link.domain_hostname ?? null);
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export type ArchivedFilter = '0' | '1' | 'all';

export interface ListLinksParams {
  q?: string;
  tag?: string;
  archived?: ArchivedFilter;
  sort?: 'created' | 'clicks';
  /** Solo los links que creó esta persona (id real). */
  creator?: string;
  page?: number;
  pageSize?: number;
}

export interface ListLinksResult {
  links: LinkWithDomain[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listLinks(
  userId: string,
  params: ListLinksParams,
): Promise<ListLinksResult> {
  const db = getDb();
  const where: string[] = ['l.user_id = ?'];
  const args: Array<string | number> = [userId];

  const archived: ArchivedFilter = params.archived ?? '0';
  if (archived === '0') where.push('l.archived = 0');
  else if (archived === '1') where.push('l.archived = 1');

  if (params.q) {
    const like = `%${escapeLike(params.q)}%`;
    where.push(`(l.slug LIKE ? ESCAPE '\\' OR l.url LIKE ? ESCAPE '\\' OR l.title LIKE ? ESCAPE '\\')`);
    args.push(like, like, like);
  }
  if (params.tag) {
    where.push(`l.tags LIKE ? ESCAPE '\\'`);
    args.push(`%"${escapeLike(params.tag)}"%`);
  }
  if (params.creator) {
    where.push('l.created_by = ?');
    args.push(params.creator);
  }

  const whereSql = where.join(' AND ');
  const pageSize = Math.min(Math.max(params.pageSize ?? 10, 1), 50);
  const total = (
    (await db.prepare(`SELECT COUNT(*) AS c FROM links l WHERE ${whereSql}`).get(...args)) as {
      c: number;
    }
  ).c;
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(params.page ?? 1, 1), pages);
  const order = params.sort === 'clicks' ? 'l.clicks DESC, l.created_at DESC' : 'l.created_at DESC, l.id';
  const links = (await db
    .prepare(`${LINK_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize)) as LinkWithDomain[];

  return { links, total, page, pageSize };
}

/** All distinct tags used by a user's links (for filter chips). */
export async function userTags(userId: string): Promise<string[]> {
  // DISTINCT en la base: no viaja una fila por link (un workspace puede tener
  // decenas de miles) solo para armar los chips. JSON roto cuenta como sin tags.
  const rows = (await getDb()
    .prepare(
      `SELECT DISTINCT j.value AS tag FROM links l,
         json_each(CASE WHEN json_valid(l.tags) THEN l.tags ELSE '[]' END) j
       WHERE l.user_id = ? AND j.type = 'text' LIMIT 500`,
    )
    .all(userId)) as Array<{ tag: string }>;
  return rows.map((r) => r.tag).sort();
}

export interface LinkCreator {
  id: string;
  name: string | null;
  email: string;
}

/** Las personas que crearon algún link del workspace (para el filtro "Creado por"). */
export async function linkCreators(userId: string): Promise<LinkCreator[]> {
  return (await getDb()
    .prepare(
      `SELECT u.id, u.name, u.email FROM users u
       WHERE u.id IN (SELECT DISTINCT created_by FROM links WHERE user_id = ? AND created_by IS NOT NULL)
       ORDER BY COALESCE(u.name, u.email) LIMIT 200`,
    )
    .all(userId)) as LinkCreator[];
}

/** Nombre (o email) de quien creó el link; null si es un link viejo o la persona ya no existe. */
export async function linkCreatorName(createdBy: string | null | undefined): Promise<string | null> {
  if (!createdBy) return null;
  const row = (await getDb().prepare('SELECT name, email FROM users WHERE id = ?').get(createdBy)) as
    | { name: string | null; email: string }
    | undefined;
  return row ? row.name || row.email : null;
}

// ---------- Status ----------

export function isExpired(link: LinkRow): boolean {
  return !!link.expires_at && new Date(link.expires_at).getTime() <= Date.now();
}

/** Llegó a max_clicks: /r ya responde gone('limit'). */
export function isLimitReached(link: Pick<LinkRow, 'max_clicks' | 'clicks'>): boolean {
  return link.max_clicks !== null && link.clicks >= link.max_clicks;
}

export type LinkStatus = 'active' | 'archived' | 'expired' | 'limit' | 'protected';

export function linkStatus(link: LinkRow): LinkStatus {
  if (link.archived === 1) return 'archived';
  if (isExpired(link)) return 'expired';
  if (isLimitReached(link)) return 'limit';
  if (link.password_hash) return 'protected';
  return 'active';
}

// ---------- DTO (never leaks password_hash) ----------

export interface LinkDto {
  id: string;
  slug: string;
  /** Dominio propio (null = dominio por defecto). */
  domain: string | null;
  short_url: string;
  url: string;
  title: string | null;
  tags: string[];
  archived: boolean;
  redirect_type: 301 | 302;
  expires_at: string | null;
  max_clicks: number | null;
  has_password: boolean;
  utm: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    term: string | null;
    content: string | null;
  };
  og: { title: string | null; description: string | null; image: string | null };
  clicks: number;
  /** Visitas que llegaron escaneando el QR (también cuentan en clicks). */
  qr_scans: number;
  /** Segmentación por país/dispositivo, A/B y deep links (null = sin reglas). */
  targeting: LinkTargeting | null;
  /** Los query params del link corto se suman al destino (?utm_source=… gana sobre el del destino). */
  forward_params: boolean;
  /** A dónde redirige el link vencido o sin clicks disponibles (null = página de zerosoft o el default del dominio). */
  expired_url: string | null;
  /** Id de la persona que lo creó (null en links viejos). */
  created_by: string | null;
  /** Id propio del cliente de la API (único por workspace). */
  external_id: string | null;
  created_at: string;
  updated_at: string;
}

export function toLinkDto(link: LinkWithDomain): LinkDto {
  return {
    id: link.id,
    slug: link.slug,
    domain: link.domain_hostname ?? null,
    short_url: linkShortUrl(link),
    url: link.url,
    title: link.title,
    tags: parseTags(link.tags),
    archived: link.archived === 1,
    redirect_type: link.redirect_type === 301 ? 301 : 302,
    expires_at: link.expires_at,
    max_clicks: link.max_clicks,
    has_password: !!link.password_hash,
    utm: {
      source: link.utm_source,
      medium: link.utm_medium,
      campaign: link.utm_campaign,
      term: link.utm_term ?? null,
      content: link.utm_content ?? null,
    },
    og: { title: link.og_title, description: link.og_description, image: link.og_image },
    clicks: link.clicks,
    qr_scans: link.qr_scans ?? 0,
    targeting: parseTargeting(link.targeting),
    forward_params: link.forward_params !== 0,
    expired_url: link.expired_url ?? null,
    created_by: link.created_by ?? null,
    external_id: link.external_id ?? null,
    created_at: link.created_at,
    updated_at: link.updated_at,
  };
}

// ---------- Passwords (scrypt, "salt:hash" hex) ----------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scryptAsync(password, salt, 64)).toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---------- Password gate cookie (HMAC) ----------

function gateSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('NEXTAUTH_SECRET is required');
  return 'zerosoft-gate-secret-dev';
}

export const gateCookieName = (slug: string): string => `zs_gate_${slug}`;

/** Referrer de la visita antes de pasar por la puerta (el Referer de vuelta es la puerta misma). */
export const gateRefCookieName = (slug: string): string => `zs_gref_${slug}`;

export function gateToken(slug: string, passwordHash: string): string {
  return createHmac('sha256', gateSecret()).update(`${slug}:${passwordHash}`).digest('hex');
}

export function isValidGateToken(
  slug: string,
  passwordHash: string,
  token: string | undefined,
): boolean {
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(gateToken(slug, passwordHash));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- UTM ----------

export interface UtmResult {
  url: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
}

/** Appends utm_* query params to the destination URL (if any is present). */
export function applyUtm(
  url: string,
  utm: { source?: string; medium?: string; campaign?: string; term?: string; content?: string },
): UtmResult {
  const values = {
    source: utm.source?.trim() || null,
    medium: utm.medium?.trim() || null,
    campaign: utm.campaign?.trim() || null,
    term: utm.term?.trim() || null,
    content: utm.content?.trim() || null,
  };
  if (!Object.values(values).some(Boolean)) return { url, ...values };
  const u = new URL(url);
  for (const [field, value] of Object.entries(values)) if (value) u.searchParams.set(`utm_${field}`, value);
  return { url: u.toString(), ...values };
}

/**
 * URL de fallback (link vencido, slug inexistente): http(s) válida y que no
 * sea otro link corto nuestro (armaría un loop). '' o null la borran.
 */
export async function cleanFallbackUrl(
  raw: string | null | undefined,
): Promise<{ ok: true; value: string | null } | { ok: false; code: 'invalid_url' | 'self_link' }> {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: true, value: null };
  const normalized = normalizeUrl(trimmed);
  if (normalized.length > 2000 || !isValidUrl(normalized)) return { ok: false, code: 'invalid_url' };
  if (await isShortLinkUrl(normalized)) return { ok: false, code: 'self_link' };
  return { ok: true, value: normalized };
}

// ---------- Abuso ----------

/**
 * La URL es un link corto nuestro (zerosoft.ai/<slug>, /r/<slug>, /s/<slug>,
 * /<locale>/gate/<slug> o un dominio propio verificado). Como destino arma loops de redirects que
 * inflan clicks, webhooks y gastan max_clicks.
 */
export async function isShortLinkUrl(url: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = normalizeHost(u.host).replace(/^www\./, '');
  const bare = host.replace(/:\d+$/, '');
  const ours = new Set([...appHosts(), normalizeHost(shortDomain())].map((h) => h.replace(/^www\./, '')));
  // Next decodifica los params (/r/%61bc resuelve el slug 'abc'): se valida decodificado.
  const path = u.pathname
    .split('/')
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join('/');
  const m = /^\/(?:([rs]|(?:en|es|pt)\/gate)\/)?([^/]+)\/?$/.exec(path);
  // Los *.vercel.app de deployments anteriores del proyecto sirven los mismos links (misma DB).
  if (ours.has(host) || ours.has(bare) || isOwnDeploymentHost(bare)) {
    if (!m) return false;
    // /r/<slug>, /s/<slug> y la puerta siempre son links; /<slug> solo si no es una ruta del sitio.
    return m[1] ? SLUG_REGEX.test(m[2]) : isValidSlug(m[2]);
  }
  // La raíz de un dominio propio redirige a su root_url (/r/__root): también arma loops.
  if (!m && path !== '/') return false;
  return Boolean(await getVerifiedDomainByHost(bare));
}

/** Tope de links nuevos por workspace en 24 h (LINK_DAILY_QUOTA, 0 = sin tope). */
export function linkDailyQuota(): number {
  const raw = Number(process.env.LINK_DAILY_QUOTA ?? 2000);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 2000;
}

/** Cuántos links más puede crear el usuario en las últimas 24 h (Infinity sin tope). */
export async function linkQuotaRemaining(userId: string): Promise<number> {
  const quota = linkDailyQuota();
  if (quota === 0) return Infinity;
  const used = (
    (await getDb()
      .prepare(`SELECT COUNT(*) AS c FROM links WHERE user_id = ? AND created_at >= datetime('now', '-1 day')`)
      .get(userId)) as { c: number }
  ).c;
  return Math.max(0, quota - used);
}

// ---------- Create ----------

export interface CreateLinkInput {
  url: string;
  slug?: string;
  /** Dominio propio verificado del usuario (id). */
  domainId?: string | null;
  title?: string;
  tags?: string[];
  expiresAt?: string | null;
  maxClicks?: number | null;
  password?: string;
  redirectType?: 301 | 302;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  /** Pasar los query params del link corto al destino (default true). */
  forwardParams?: boolean;
  /** A dónde va el link cuando vence o llega a max_clicks. */
  expiredUrl?: string | null;
  /** Segmentación por país/dispositivo, A/B y deep links. */
  targeting?: LinkTargetingInput | null;
  /** Id propio del cliente (API v1), único por workspace. */
  externalId?: string | null;
  /** Persona que lo crea (id real; en un team, no el del owner). */
  createdBy?: string | null;
  /** Solo interno (duplicar): hash ya calculado en vez de `password`. */
  passwordHash?: string | null;
}

/** Id externo: 1-255 caracteres sin espacios ni barras (va en la URL como ext_<id>). */
export const EXTERNAL_ID_RE = /^[A-Za-z0-9._:@-]{1,255}$/;

export type CreateLinkError =
  | 'invalid_url'
  | 'invalid_slug'
  | 'slug_taken'
  | 'invalid_date'
  | 'invalid_domain'
  | 'self_link'
  | 'invalid_expired_url'
  | 'invalid_og_image'
  | 'invalid_external_id'
  | 'external_id_taken'
  | 'invalid_targeting_url'
  | 'empty_rule'
  | 'ab_needs_two'
  | 'ab_zero_weight'
  | 'quota_exceeded';

export type CreateLinkResult =
  | { ok: true; link: LinkRow }
  | { ok: false; code: CreateLinkError };

/** Shared create logic for the session API and the public v1 API. */
export async function createLink(
  userId: string,
  input: CreateLinkInput,
): Promise<CreateLinkResult> {
  const db = getDb();

  const normalized = normalizeUrl(input.url);
  if (!isValidUrl(normalized)) return { ok: false, code: 'invalid_url' };
  if (await isShortLinkUrl(normalized)) return { ok: false, code: 'self_link' };
  if ((await linkQuotaRemaining(userId)) <= 0) return { ok: false, code: 'quota_exceeded' };

  const domainId = input.domainId || null;
  if (domainId) {
    const domain = await db
      .prepare('SELECT 1 AS x FROM link_domains WHERE id = ? AND user_id = ? AND verified = 1')
      .get(domainId, userId);
    if (!domain) return { ok: false, code: 'invalid_domain' };
  }

  let slug: string;
  const customSlug = Boolean(input.slug && input.slug.trim());
  if (input.slug && input.slug.trim()) {
    slug = input.slug.trim();
    if (!isValidSlug(slug, Boolean(domainId))) return { ok: false, code: 'invalid_slug' };
    if (await slugExists(slug, domainId)) return { ok: false, code: 'slug_taken' };
  } else {
    slug = await generateSlug(domainId);
  }

  // Los utm_* se derivan de la URL final: si el destino ya traía utm_source,
  // la columna lo refleja aunque no se haya cargado en el campo.
  const applied = applyUtm(normalized, {
    source: input.utmSource,
    medium: input.utmMedium,
    campaign: input.utmCampaign,
    term: input.utmTerm,
    content: input.utmContent,
  });
  const utm = { url: applied.url, ...syncUtm(applied.url).utm };

  const expired = await cleanFallbackUrl(input.expiredUrl);
  if (!expired.ok) return { ok: false, code: expired.code === 'self_link' ? 'self_link' : 'invalid_expired_url' };

  let expiresAt: string | null = null;
  if (input.expiresAt) {
    const d = new Date(input.expiresAt);
    if (Number.isNaN(d.getTime())) return { ok: false, code: 'invalid_date' };
    expiresAt = d.toISOString();
  }

  const ogImage = input.ogImage?.trim() || null;
  if (ogImage && !isValidUrl(normalizeUrl(ogImage))) return { ok: false, code: 'invalid_og_image' };

  let targeting: LinkTargeting | null = null;
  if (input.targeting) {
    const parsedTargeting = linkTargetingSchema.safeParse(input.targeting);
    if (!parsedTargeting.success) return { ok: false, code: 'invalid_targeting_url' };
    const t = normalizeTargeting(parsedTargeting.data);
    if (!t.ok) return { ok: false, code: t.error as CreateLinkError };
    // Mismo anti-loop que el destino: ninguna variante puede volver a un link corto.
    for (const url of t.value ? targetingDestinations(t.value) : []) {
      if (await isShortLinkUrl(url)) return { ok: false, code: 'self_link' };
    }
    targeting = t.value;
  }

  const externalId = input.externalId?.trim() || null;
  if (externalId) {
    if (!EXTERNAL_ID_RE.test(externalId)) return { ok: false, code: 'invalid_external_id' };
    if (await getUserLinkByExternalId(userId, externalId)) return { ok: false, code: 'external_id_taken' };
  }

  const tags = (input.tags ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);

  const id = crypto.randomUUID();
  const redirectType = input.redirectType === 301 ? 301 : 302;
  const passwordHash = input.passwordHash ?? (input.password ? await hashPassword(input.password) : null);
  for (let attempt = 0; ; attempt++) {
    try {
      await db
        .prepare(
          `INSERT INTO links (id, user_id, domain_id, slug, url, title, tags, password_hash, expires_at, max_clicks, redirect_type, utm_source, utm_medium, utm_campaign, utm_term, utm_content, og_title, og_description, og_image, forward_params, expired_url, targeting, external_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          userId,
          domainId,
          slug,
          utm.url,
          input.title?.trim() || null,
          JSON.stringify(tags),
          passwordHash,
          expiresAt,
          input.maxClicks ?? null,
          redirectType,
          utm.source,
          utm.medium,
          utm.campaign,
          utm.term,
          utm.content,
          input.ogTitle?.trim() || null,
          input.ogDescription?.trim() || null,
          ogImage,
          input.forwardParams === false ? 0 : 1,
          expired.value,
          targeting ? JSON.stringify(targeting) : null,
          externalId,
          input.createdBy || null,
        );
      break;
    } catch (e) {
      // Carrera con otra alta al mismo slug (doble submit, import en paralelo):
      // el UNIQUE lo frena. Slug propio → slug_taken; generado → otro slug.
      if (!/UNIQUE constraint failed/i.test(String(e))) throw e;
      if (/external_id/i.test(String(e))) return { ok: false, code: 'external_id_taken' };
      if (customSlug || attempt >= 2) return { ok: false, code: 'slug_taken' };
      slug = await generateSlug(domainId);
    }
  }

  const created = (await getUserLink(userId, id))!;
  await emitEvent(userId, 'link.created', { link: toLinkDto(created) });
  return { ok: true, link: created };
}

// ---------- Bulk create ----------

export interface BulkCreateInput {
  urls: string[];
  tag?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  createdBy?: string | null;
}

export { bulkResultsToCsv, type BulkResultItem } from './link-bulk-csv';

/** Creates many links in one call. Returns per-line results preserving order. */
export async function createLinksBulk(
  userId: string,
  input: BulkCreateInput,
): Promise<BulkResultItem[]> {
  const commonTag = input.tag?.trim();
  const results: BulkResultItem[] = [];

  for (const raw of input.urls) {
    const url = raw.trim();
    if (!url) {
      results.push({ url, short_url: '', status: 'error', error: 'empty' });
      continue;
    }
    const result = await createLink(userId, {
      url,
      tags: commonTag ? [commonTag] : undefined,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      createdBy: input.createdBy,
    });
    if (result.ok) {
      results.push({ url, short_url: shortUrl(result.link.slug), status: 'created' });
    } else {
      results.push({ url, short_url: '', status: 'error', error: result.code });
    }
  }

  return results;
}

// ---------- Edición (app y API v1) ----------

export const linkPatchSchema = z.object({
  url: z.string().min(1).optional(),
  title: z.string().max(200).nullable().optional(),
  tags: z.array(z.string().max(40)).max(5).optional(),
  expiresAt: z.string().nullable().optional(),
  maxClicks: z.number().int().positive().nullable().optional(),
  archived: z.boolean().optional(),
  password: z.string().max(100).optional(), // '' clears, string sets
  slug: z.string().max(32).optional(),
  redirectType: z.union([z.literal(301), z.literal(302)]).optional(),
  ogTitle: z.string().max(200).nullable().optional(),
  ogDescription: z.string().max(500).nullable().optional(),
  ogImage: z.string().max(500).nullable().optional(),
  targeting: linkTargetingSchema.nullable().optional(),
  // UTM: undefined no toca, '' o null saca el param del destino, texto lo pone.
  utmSource: z.string().max(100).nullable().optional(),
  utmMedium: z.string().max(100).nullable().optional(),
  utmCampaign: z.string().max(100).nullable().optional(),
  utmTerm: z.string().max(100).nullable().optional(),
  utmContent: z.string().max(100).nullable().optional(),
  forwardParams: z.boolean().optional(),
  expiredUrl: z.string().max(2000).nullable().optional(),
  /** Id propio del cliente (API v1); null lo saca. */
  externalId: z.string().max(255).nullable().optional(),
});

export type LinkPatch = z.infer<typeof linkPatchSchema>;

/** Aplica un PATCH validado a un link del usuario. Devuelve el error o null. */
export async function applyLinkPatch(
  link: LinkWithDomain,
  p: LinkPatch,
): Promise<{ error: string; status: number } | null> {
  const sets: string[] = [];
  const args: Array<string | number | null> = [];

  const utmTouched =
    p.utmSource !== undefined ||
    p.utmMedium !== undefined ||
    p.utmCampaign !== undefined ||
    p.utmTerm !== undefined ||
    p.utmContent !== undefined;
  if (p.url !== undefined || utmTouched) {
    const base = p.url !== undefined ? normalizeUrl(p.url) : link.url;
    if (!isValidUrl(base)) return { error: 'invalid_url', status: 400 };
    // Los UTM viven en la URL: se aplican sobre el destino final y las
    // columnas utm_* se derivan de ella, así nunca quedan desfasadas.
    const synced = syncUtm(base, {
      source: p.utmSource,
      medium: p.utmMedium,
      campaign: p.utmCampaign,
      term: p.utmTerm,
      content: p.utmContent,
    });
    const normalized = synced.url;
    if (await isShortLinkUrl(normalized)) return { error: 'self_link', status: 400 };
    sets.push('url = ?', 'utm_source = ?', 'utm_medium = ?', 'utm_campaign = ?', 'utm_term = ?', 'utm_content = ?');
    args.push(
      normalized,
      synced.utm.source,
      synced.utm.medium,
      synced.utm.campaign,
      synced.utm.term,
      synced.utm.content,
    );
    // La variante A del A/B nace como copia del destino del link: si sigue
    // apuntando al destino viejo, se mueve con él (si no, la mitad del
    // tráfico quedaría yendo a la URL anterior para siempre).
    const current = p.targeting === undefined ? parseTargeting(link.targeting) : null;
    if (current && normalized !== link.url && current.ab.some((v) => v.url === link.url)) {
      const ab = current.ab.map((v) => (v.url === link.url ? { ...v, url: normalized } : v));
      sets.push('targeting = ?');
      args.push(JSON.stringify({ ...current, ab }));
    }
  }
  if (p.title !== undefined) {
    sets.push('title = ?');
    args.push(p.title?.trim() || null);
  }
  if (p.tags !== undefined) {
    sets.push('tags = ?');
    args.push(JSON.stringify(p.tags.map((t) => t.trim()).filter(Boolean).slice(0, 5)));
  }
  if (p.expiresAt !== undefined) {
    if (p.expiresAt === null) {
      sets.push('expires_at = ?');
      args.push(null);
    } else {
      const d = new Date(p.expiresAt);
      if (Number.isNaN(d.getTime())) {
        return { error: 'invalid_date', status: 400 };
      }
      sets.push('expires_at = ?');
      args.push(d.toISOString());
    }
  }
  if (p.maxClicks !== undefined) {
    sets.push('max_clicks = ?');
    args.push(p.maxClicks);
  }
  if (p.archived !== undefined) {
    sets.push('archived = ?');
    args.push(p.archived ? 1 : 0);
  }
  if (p.password !== undefined) {
    sets.push('password_hash = ?');
    args.push(p.password === '' ? null : await hashPassword(p.password));
  }
  if (p.slug !== undefined && p.slug !== link.slug) {
    const slug = p.slug.trim();
    // Mismas reglas que al crear: los reservados solo aplican al dominio por
    // defecto y la colisión es por dominio (índice idx_links_domain_slug).
    if (!isValidSlug(slug, Boolean(link.domain_id))) return { error: 'invalid_slug', status: 400 };
    const taken = await getDb()
      .prepare("SELECT 1 AS x FROM links WHERE slug = ? AND COALESCE(domain_id, '') = ? AND id != ?")
      .get(slug, link.domain_id ?? '', link.id);
    if (taken) return { error: 'slug_taken', status: 409 };
    sets.push('slug = ?');
    args.push(slug);
  }
  if (p.redirectType !== undefined) {
    sets.push('redirect_type = ?');
    args.push(p.redirectType === 301 ? 301 : 302);
  }
  if (p.ogTitle !== undefined) {
    sets.push('og_title = ?');
    args.push(p.ogTitle?.trim() || null);
  }
  if (p.ogDescription !== undefined) {
    sets.push('og_description = ?');
    args.push(p.ogDescription?.trim() || null);
  }
  if (p.ogImage !== undefined) {
    const ogImage = p.ogImage?.trim() || null;
    if (ogImage && !isValidUrl(normalizeUrl(ogImage))) return { error: 'invalid_og_image', status: 400 };
    sets.push('og_image = ?');
    args.push(ogImage);
  }
  if (p.externalId !== undefined) {
    const externalId = p.externalId?.trim() || null;
    if (externalId && !EXTERNAL_ID_RE.test(externalId)) return { error: 'invalid_external_id', status: 400 };
    if (externalId) {
      const other = await getUserLinkByExternalId(link.user_id, externalId);
      if (other && other.id !== link.id) return { error: 'external_id_taken', status: 409 };
    }
    sets.push('external_id = ?');
    args.push(externalId);
  }
  if (p.forwardParams !== undefined) {
    sets.push('forward_params = ?');
    args.push(p.forwardParams ? 1 : 0);
  }
  if (p.expiredUrl !== undefined) {
    const expired = await cleanFallbackUrl(p.expiredUrl);
    if (!expired.ok) return { error: expired.code === 'self_link' ? 'self_link' : 'invalid_expired_url', status: 400 };
    sets.push('expired_url = ?');
    args.push(expired.value);
  }
  if (p.targeting !== undefined) {
    if (p.targeting === null) {
      sets.push('targeting = ?');
      args.push(null);
    } else {
      const t = normalizeTargeting(p.targeting);
      if (!t.ok) return { error: t.error, status: 400 };
      // Mismo anti-loop que la URL del link: ninguna variante puede volver a un link corto.
      for (const url of t.value ? targetingDestinations(t.value) : []) {
        if (await isShortLinkUrl(url)) return { error: 'self_link', status: 400 };
      }
      sets.push('targeting = ?');
      args.push(t.value ? JSON.stringify(t.value) : null);
    }
  }

  if (sets.length > 0) {
    sets.push(`updated_at = datetime('now')`);
    try {
      await getDb()
        .prepare(`UPDATE links SET ${sets.join(', ')} WHERE id = ?`)
        .run(...args, link.id);
    } catch (e) {
      // Carrera con otro rename/alta al mismo slug (o id externo): el UNIQUE lo frena.
      if (/UNIQUE constraint failed/i.test(String(e))) {
        return { error: /external_id/i.test(String(e)) ? 'external_id_taken' : 'slug_taken', status: 409 };
      }
      throw e;
    }
    const updated = await getUserLink(link.user_id, link.id);
    if (updated) {
      const changes = Object.keys(p).filter((k) => p[k as keyof LinkPatch] !== undefined);
      await emitEvent(link.user_id, 'link.updated', { link: toLinkDto(updated), changes });
    }
  }

  return null;
}

// ---------- Borrar y duplicar ----------

/** Borra el link (y sus clicks, en cascada) y emite link.deleted con su último estado. */
export async function deleteLink(link: LinkWithDomain): Promise<void> {
  const dto = toLinkDto(link);
  await getDb().prepare('DELETE FROM links WHERE id = ? AND user_id = ?').run(link.id, link.user_id);
  await emitEvent(link.user_id, 'link.deleted', { link: dto });
}

/**
 * Copia de un link con slug nuevo (generado) en el mismo dominio: destino,
 * UTM, tags, segmentación, vencimiento, límite, contraseña, vista previa y
 * fallback. No copia clicks, comentarios, el id externo ni el estado archivado.
 */
export async function duplicateLink(link: LinkWithDomain, createdBy: string | null): Promise<CreateLinkResult> {
  const targeting = parseTargeting(link.targeting);
  return createLink(link.user_id, {
    url: link.url,
    domainId: link.domain_id,
    title: link.title ?? undefined,
    tags: parseTags(link.tags),
    expiresAt: link.expires_at,
    maxClicks: link.max_clicks,
    passwordHash: link.password_hash,
    redirectType: link.redirect_type === 301 ? 301 : 302,
    ogTitle: link.og_title ?? undefined,
    ogDescription: link.og_description ?? undefined,
    ogImage: link.og_image ?? undefined,
    forwardParams: link.forward_params !== 0,
    expiredUrl: link.expired_url ?? null,
    targeting,
    createdBy,
  });
}

// ---------- Acciones masivas (multi-select de la tabla) ----------

export const linkBulkActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('archive'), ids: z.array(z.string().min(1).max(64)).min(1).max(500) }),
  z.object({ action: z.literal('unarchive'), ids: z.array(z.string().min(1).max(64)).min(1).max(500) }),
  z.object({ action: z.literal('delete'), ids: z.array(z.string().min(1).max(64)).min(1).max(500) }),
  z.object({
    action: z.literal('tag'),
    ids: z.array(z.string().min(1).max(64)).min(1).max(500),
    tag: z.string().trim().min(1).max(40),
  }),
]);

export type LinkBulkAction = z.infer<typeof linkBulkActionSchema>;

/**
 * Aplica una acción a varios links del usuario. Solo toca filas con
 * `user_id = userId`: ids ajenos se ignoran (aislamiento de workspace).
 * Devuelve cuántos links se afectaron.
 */
export async function bulkLinkAction(userId: string, input: LinkBulkAction): Promise<number> {
  const db = getDb();
  const ids = [...new Set(input.ids)];
  const ph = ids.map(() => '?').join(',');
  const linksByIds = async (only: string[]) =>
    only.length === 0
      ? []
      : ((await db
          .prepare(`${LINK_SELECT} WHERE l.user_id = ? AND l.id IN (${only.map(() => '?').join(',')})`)
          .all(userId, ...only)) as LinkWithDomain[]);
  if (input.action === 'archive' || input.action === 'unarchive') {
    const archived = input.action === 'archive' ? 1 : 0;
    // Solo los que cambian de estado emiten link.updated.
    const changing = (await linksByIds(ids)).filter((l) => l.archived !== archived).map((l) => l.id);
    const res = await db
      .prepare(`UPDATE links SET archived = ?, updated_at = datetime('now') WHERE user_id = ? AND id IN (${ph})`)
      .run(archived, userId, ...ids);
    for (const l of await linksByIds(changing)) {
      await emitEvent(userId, 'link.updated', { link: toLinkDto(l), changes: ['archived'] });
    }
    return res.changes;
  }
  if (input.action === 'delete') {
    const before = await linksByIds(ids);
    const res = await db.prepare(`DELETE FROM links WHERE user_id = ? AND id IN (${ph})`).run(userId, ...ids);
    for (const l of before) await emitEvent(userId, 'link.deleted', { link: toLinkDto(l) });
    return res.changes;
  }
  // tag: se agrega a los tags existentes (máx. 5 por link, sin duplicar).
  const rows = (await db
    .prepare(`SELECT id, tags FROM links WHERE user_id = ? AND id IN (${ph})`)
    .all(userId, ...ids)) as Array<{ id: string; tags: string | null }>;
  const tagged: string[] = [];
  for (const row of rows) {
    const tags = parseTags(row.tags);
    if (tags.includes(input.tag) || tags.length >= 5) continue;
    await db
      .prepare(`UPDATE links SET tags = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
      .run(JSON.stringify([...tags, input.tag]), row.id, userId);
    tagged.push(row.id);
  }
  for (const l of await linksByIds(tagged)) {
    await emitEvent(userId, 'link.updated', { link: toLinkDto(l), changes: ['tags'] });
  }
  return tagged.length;
}
