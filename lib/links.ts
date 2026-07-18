import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { customAlphabet } from 'nanoid';
import { getDb, type LinkRow } from './db';
import { isValidSlug } from './reserved';
import { isValidUrl, normalizeUrl, shortUrl } from './utils';

// ---------- Slugs ----------

const nanoSlug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 7);

export async function slugExists(slug: string): Promise<boolean> {
  return !!(await getDb().prepare('SELECT 1 AS x FROM links WHERE slug = ?').get(slug));
}

/** Random 7-char lowercase alphanumeric slug, regenerated on collision. */
export async function generateSlug(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const candidate = nanoSlug();
    if (isValidSlug(candidate) && !(await slugExists(candidate))) return candidate;
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

export async function getLinkBySlug(slug: string): Promise<LinkRow | undefined> {
  return (await getDb().prepare('SELECT * FROM links WHERE slug = ?').get(slug)) as
    | LinkRow
    | undefined;
}

export async function getUserLink(userId: string, id: string): Promise<LinkRow | undefined> {
  return (await getDb()
    .prepare('SELECT * FROM links WHERE id = ? AND user_id = ?')
    .get(id, userId)) as LinkRow | undefined;
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
  links: LinkRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listLinks(
  userId: string,
  params: ListLinksParams,
): Promise<ListLinksResult> {
  const db = getDb();
  const where: string[] = ['user_id = ?'];
  const args: Array<string | number> = [userId];

  const archived: ArchivedFilter = params.archived ?? '0';
  if (archived === '0') where.push('archived = 0');
  else if (archived === '1') where.push('archived = 1');

  if (params.q) {
    const like = `%${escapeLike(params.q)}%`;
    where.push(`(slug LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')`);
    args.push(like, like, like);
  }
  if (params.tag) {
    where.push(`tags LIKE ? ESCAPE '\\'`);
    args.push(`%"${escapeLike(params.tag)}"%`);
  }

  const whereSql = where.join(' AND ');
  const pageSize = Math.min(Math.max(params.pageSize ?? 10, 1), 50);
  const total = (
    (await db.prepare(`SELECT COUNT(*) AS c FROM links WHERE ${whereSql}`).get(...args)) as {
      c: number;
    }
  ).c;
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(params.page ?? 1, 1), pages);
  const order = params.sort === 'clicks' ? 'clicks DESC, created_at DESC' : 'created_at DESC, id';
  const links = (await db
    .prepare(`SELECT * FROM links WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize)) as LinkRow[];

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
  short_url: string;
  url: string;
  title: string | null;
  tags: string[];
  archived: boolean;
  expires_at: string | null;
  max_clicks: number | null;
  has_password: boolean;
  utm: { source: string | null; medium: string | null; campaign: string | null };
  clicks: number;
  created_at: string;
  updated_at: string;
}

export function toLinkDto(link: LinkRow): LinkDto {
  return {
    id: link.id,
    slug: link.slug,
    short_url: shortUrl(link.slug),
    url: link.url,
    title: link.title,
    tags: parseTags(link.tags),
    archived: link.archived === 1,
    expires_at: link.expires_at,
    max_clicks: link.max_clicks,
    has_password: !!link.password_hash,
    utm: { source: link.utm_source, medium: link.utm_medium, campaign: link.utm_campaign },
    clicks: link.clicks,
    created_at: link.created_at,
    updated_at: link.updated_at,
  };
}

// ---------- Passwords (scrypt, "salt:hash" hex) ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---------- Password gate cookie (HMAC) ----------

function gateSecret(): string {
  return process.env.NEXTAUTH_SECRET ?? 'zerosoft-gate-secret';
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
  title?: string;
  tags?: string[];
  expiresAt?: string | null;
  maxClicks?: number | null;
  password?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

export type CreateLinkError = 'invalid_url' | 'invalid_slug' | 'slug_taken' | 'invalid_date';

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

  let slug: string;
  if (input.slug && input.slug.trim()) {
    slug = input.slug.trim();
    if (!isValidSlug(slug)) return { ok: false, code: 'invalid_slug' };
    if (await slugExists(slug)) return { ok: false, code: 'slug_taken' };
  } else {
    slug = await generateSlug();
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
  await db
    .prepare(
      `INSERT INTO links (id, user_id, slug, url, title, tags, password_hash, expires_at, max_clicks, utm_source, utm_medium, utm_campaign)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      slug,
      utm.url,
      input.title?.trim() || null,
      JSON.stringify(tags),
      input.password ? hashPassword(input.password) : null,
      expiresAt,
      input.maxClicks ?? null,
      utm.source,
      utm.medium,
      utm.campaign,
    );

  return { ok: true, link: (await getUserLink(userId, id))! };
}
