import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;
import { customAlphabet } from 'nanoid';
import { z } from 'zod';
import { getDb, type LinkRow } from './db';
import { isValidSlug } from './reserved';
import { isValidUrl, normalizeUrl, shortUrl } from './utils';
import { isAppHost } from './hosts';
import { getVerifiedDomainByHost } from './link-domains';
import { emitEvent } from './events';
import { linkTargetingSchema, normalizeTargeting, parseTargeting, type LinkTargeting } from './link-targeting';

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
  const rows = (await getDb()
    .prepare('SELECT tags FROM links WHERE user_id = ?')
    .all(userId)) as Array<{
    tags: string;
  }>;
  const set = new Set<string>();
  for (const row of rows) for (const tag of parseTags(row.tags)) set.add(tag);
  return [...set].sort();
}

// ---------- Status ----------

export function isExpired(link: LinkRow): boolean {
  return !!link.expires_at && new Date(link.expires_at).getTime() <= Date.now();
}

export type LinkStatus = 'active' | 'archived' | 'expired' | 'protected';

export function linkStatus(link: LinkRow): LinkStatus {
  if (link.archived === 1) return 'archived';
  if (isExpired(link)) return 'expired';
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
  utm: { source: string | null; medium: string | null; campaign: string | null };
  og: { title: string | null; description: string | null; image: string | null };
  clicks: number;
  /** Visitas que llegaron escaneando el QR (también cuentan en clicks). */
  qr_scans: number;
  /** Segmentación por país/dispositivo, A/B y deep links (null = sin reglas). */
  targeting: LinkTargeting | null;
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
    utm: { source: link.utm_source, medium: link.utm_medium, campaign: link.utm_campaign },
    og: { title: link.og_title, description: link.og_description, image: link.og_image },
    clicks: link.clicks,
    qr_scans: link.qr_scans ?? 0,
    targeting: parseTargeting(link.targeting),
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
}

/** Appends utm_* query params to the destination URL (if any is present). */
export function applyUtm(
  url: string,
  utm: { source?: string; medium?: string; campaign?: string },
): UtmResult {
  const source = utm.source?.trim() || null;
  const medium = utm.medium?.trim() || null;
  const campaign = utm.campaign?.trim() || null;
  if (!source && !medium && !campaign) return { url, source: null, medium: null, campaign: null };
  const u = new URL(url);
  if (source) u.searchParams.set('utm_source', source);
  if (medium) u.searchParams.set('utm_medium', medium);
  if (campaign) u.searchParams.set('utm_campaign', campaign);
  return { url: u.toString(), source, medium, campaign };
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
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
}

export type CreateLinkError = 'invalid_url' | 'invalid_slug' | 'slug_taken' | 'invalid_date' | 'invalid_domain';

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

  const domainId = input.domainId || null;
  if (domainId) {
    const domain = await db
      .prepare('SELECT 1 AS x FROM link_domains WHERE id = ? AND user_id = ? AND verified = 1')
      .get(domainId, userId);
    if (!domain) return { ok: false, code: 'invalid_domain' };
  }

  let slug: string;
  if (input.slug && input.slug.trim()) {
    slug = input.slug.trim();
    if (!isValidSlug(slug, Boolean(domainId))) return { ok: false, code: 'invalid_slug' };
    if (await slugExists(slug, domainId)) return { ok: false, code: 'slug_taken' };
  } else {
    slug = await generateSlug(domainId);
  }

  const utm = applyUtm(normalized, {
    source: input.utmSource,
    medium: input.utmMedium,
    campaign: input.utmCampaign,
  });

  let expiresAt: string | null = null;
  if (input.expiresAt) {
    const d = new Date(input.expiresAt);
    if (Number.isNaN(d.getTime())) return { ok: false, code: 'invalid_date' };
    expiresAt = d.toISOString();
  }

  const tags = (input.tags ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);

  const id = crypto.randomUUID();
  const redirectType = input.redirectType === 301 ? 301 : 302;
  await db
    .prepare(
      `INSERT INTO links (id, user_id, domain_id, slug, url, title, tags, password_hash, expires_at, max_clicks, redirect_type, utm_source, utm_medium, utm_campaign, og_title, og_description, og_image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      domainId,
      slug,
      utm.url,
      input.title?.trim() || null,
      JSON.stringify(tags),
      input.password ? await hashPassword(input.password) : null,
      expiresAt,
      input.maxClicks ?? null,
      redirectType,
      utm.source,
      utm.medium,
      utm.campaign,
      input.ogTitle?.trim() || null,
      input.ogDescription?.trim() || null,
      input.ogImage?.trim() || null,
    );

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
}

export interface BulkResultItem {
  url: string;
  short_url: string;
  status: 'created' | 'error';
  error?: string;
}

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
    });
    if (result.ok) {
      results.push({ url, short_url: shortUrl(result.link.slug), status: 'created' });
    } else {
      results.push({ url, short_url: '', status: 'error', error: result.code });
    }
  }

  return results;
}

export function bulkResultsToCsv(rows: BulkResultItem[]): string {
  const lines = ['original_url,short_url,status'];
  for (const row of rows) {
    lines.push(
      [csvCell(row.url), csvCell(row.short_url), csvCell(row.error ?? row.status)].join(','),
    );
  }
  return lines.join('\n');
}

function csvCell(value: string): string {
  const escaped = value.replace(/"/g, '""');
  if (/[",\n\r]/.test(escaped)) return `"${escaped}"`;
  return escaped;
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
});

export type LinkPatch = z.infer<typeof linkPatchSchema>;

/** Aplica un PATCH validado a un link del usuario. Devuelve el error o null. */
export async function applyLinkPatch(
  link: LinkWithDomain,
  p: LinkPatch,
): Promise<{ error: string; status: number } | null> {
  const sets: string[] = [];
  const args: Array<string | number | null> = [];

  if (p.url !== undefined) {
    const normalized = normalizeUrl(p.url);
    if (!isValidUrl(normalized)) return { error: 'invalid_url', status: 400 };
    sets.push('url = ?');
    args.push(normalized);
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
    if (!isValidSlug(slug)) return { error: 'invalid_slug', status: 400 };
    const taken = await getDb().prepare('SELECT 1 AS x FROM links WHERE slug = ? AND id != ?').get(slug, link.id);
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
    sets.push('og_image = ?');
    args.push(p.ogImage?.trim() || null);
  }
  if (p.targeting !== undefined) {
    if (p.targeting === null) {
      sets.push('targeting = ?');
      args.push(null);
    } else {
      const t = normalizeTargeting(p.targeting);
      if (!t.ok) return { error: t.error, status: 400 };
      sets.push('targeting = ?');
      args.push(t.value ? JSON.stringify(t.value) : null);
    }
  }

  if (sets.length > 0) {
    sets.push(`updated_at = datetime('now')`);
    await getDb()
      .prepare(`UPDATE links SET ${sets.join(', ')} WHERE id = ?`)
      .run(...args, link.id);
  }

  return null;
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
  if (input.action === 'archive' || input.action === 'unarchive') {
    const res = await db
      .prepare(`UPDATE links SET archived = ?, updated_at = datetime('now') WHERE user_id = ? AND id IN (${ph})`)
      .run(input.action === 'archive' ? 1 : 0, userId, ...ids);
    return res.changes;
  }
  if (input.action === 'delete') {
    const res = await db.prepare(`DELETE FROM links WHERE user_id = ? AND id IN (${ph})`).run(userId, ...ids);
    return res.changes;
  }
  // tag: se agrega a los tags existentes (máx. 5 por link, sin duplicar).
  const rows = (await db
    .prepare(`SELECT id, tags FROM links WHERE user_id = ? AND id IN (${ph})`)
    .all(userId, ...ids)) as Array<{ id: string; tags: string | null }>;
  let changed = 0;
  for (const row of rows) {
    const tags = parseTags(row.tags);
    if (tags.includes(input.tag) || tags.length >= 5) continue;
    await db
      .prepare(`UPDATE links SET tags = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
      .run(JSON.stringify([...tags, input.tag]), row.id, userId);
    changed++;
  }
  return changed;
}
