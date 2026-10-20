import UAParser from 'ua-parser-js';
import { ensureMigrated, getClient, getDb, type ClickRow } from './db';
import { cleanReferrerUrl } from './link-url';

// geoip-lite preloads su .dat con fs al importarse: en Vercel el bundle no lo
// incluye y rompe el módulo entero (ENOENT). Se carga lazy y a prueba de fallos —
// en Vercel el país llega por header (x-vercel-ip-country) y nunca se requiere;
// en self-host el archivo existe y funciona como antes.
type GeoipLite = typeof import('geoip-lite');
let _geoip: GeoipLite | null | undefined;

interface GeoHit {
  country: string | null;
  region: string | null;
  city: string | null;
}

function geoipLookup(ip: string): GeoHit | null {
  if (_geoip === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      _geoip = require('geoip-lite') as GeoipLite;
    } catch {
      _geoip = null;
    }
  }
  try {
    const hit = _geoip?.lookup(ip);
    if (!hit) return null;
    return { country: hit.country || null, region: hit.region || null, city: hit.city || null };
  } catch {
    return null;
  }
}

/** x-vercel-ip-city viene URL-encoded ("S%C3%A3o%20Paulo"). Máximo 100 caracteres. */
export function decodeGeoHeader(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  let out = v;
  try {
    out = decodeURIComponent(v);
  } catch {
    out = v;
  }
  out = out.trim();
  return out ? out.slice(0, 100) : null;
}

// ---------- Click capture ----------

export interface ClickContext {
  referrer: string;
  /** URL completa del referrer, sin query (salvo utm_*) ni hash. */
  referrerUrl: string | null;
  country: string | null;
  city: string | null;
  /** Subdivisión ISO 3166-2 sin el país ("C", "CA"). */
  region: string | null;
  device: string;
  browser: string;
  os: string;
}

/** Derives referrer / country / device / browser / os from the request headers. */
export function contextFromHeaders(headers: Headers): ClickContext {
  const referer = headers.get('referer');
  let referrer = 'direct';
  if (referer) {
    try {
      referrer = new URL(referer).hostname.replace(/^www\./, '') || 'direct';
    } catch {
      referrer = 'direct';
    }
  }

  // Solo headers que pone la infraestructura, no el cliente: en Vercel,
  // x-vercel-ip-country; detrás de Cloudflare (self-host), cf-ipcountry si se
  // habilita explícitamente. Si no, geoip por IP.
  let country: string | null = process.env.VERCEL
    ? headers.get('x-vercel-ip-country')
    : process.env.TRUST_CF_IPCOUNTRY === 'true'
      ? headers.get('cf-ipcountry')
      : null;
  // Ciudad y región: en Vercel por header; en self-host, la base de geoip-lite.
  let city: string | null = process.env.VERCEL ? decodeGeoHeader(headers.get('x-vercel-ip-city')) : null;
  let region: string | null = process.env.VERCEL ? decodeGeoHeader(headers.get('x-vercel-ip-country-region')) : null;
  if (!process.env.VERCEL) {
    const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const hit = ip ? geoipLookup(ip) : null;
    if (hit) {
      country = country || hit.country;
      // La ciudad de geoip solo vale si coincide el país (con cf-ipcountry podrían diferir).
      if (!country || country === hit.country) {
        city = hit.city;
        region = hit.region;
      }
    }
  }

  const ua = new UAParser(headers.get('user-agent') ?? '').getResult();
  const deviceType = ua.device.type;

  return {
    referrer,
    referrerUrl: referrer === 'direct' ? null : cleanReferrerUrl(referer),
    country: country ?? null,
    city,
    region,
    device: deviceType === 'mobile' || deviceType === 'tablet' ? deviceType : 'desktop',
    browser: ua.browser.name ?? 'Other',
    os: ua.os.name ?? 'Other',
  };
}

// Crawlers y unfurlers de previews (Slack, WhatsApp, iMessage, redes, buscadores):
// piden el link para armar la tarjeta, no son visitas. No cuentan como click.
const BOT_UA =
  /\bbot\b|bot\/|bot-|crawler|spider|slurp|facebookexternalhit|facebookcatalog|meta-externalagent|slackbot|slack-imgproxy|whatsapp|telegrambot|discordbot|twitterbot|linkedinbot|skypeuripreview|embedly|redditbot|applebot|googlebot|bingbot|yandex|baiduspider|duckduckbot|bytespider|vkshare|quora link preview|outbrain|nuzzel|bitlybot|mastodon|iframely|google web preview|curl\/|wget\/|python-requests|go-http-client|okhttp/i;

/** true si la request es de un bot o un unfurler de previews (o un HEAD): no es una visita. */
export function isBotRequest(headers: Headers, method = 'GET'): boolean {
  if (method.toUpperCase() === 'HEAD') return true;
  const ua = headers.get('user-agent') ?? '';
  if (!ua.trim()) return true;
  return BOT_UA.test(ua);
}

export interface ClickOptions {
  /** 'qr' cuando la visita viene del QR (?qr=1). */
  source?: 'link' | 'qr';
  /** Destino servido por la segmentación (rule:1, ab:B, app:ios). */
  variant?: string | null;
}

/**
 * Guarda la visita. `clicks` cuenta todas; `qr_scans` solo las del QR.
 * El incremento es condicional y atómico respecto de max_clicks: devuelve
 * null (sin registrar nada) si el link ya llegó al límite, aunque varias
 * requests concurrentes hayan pasado el chequeo previo. Si no, el total de
 * clicks con este, leído en la misma transacción (cada visita ve un número
 * distinto: los disparadores "llegó a N clicks" saltan una sola vez).
 */
export async function recordClick(linkId: string, ctx: ClickContext, opts: ClickOptions = {}): Promise<number | null> {
  await ensureMigrated();
  const source = opts.source === 'qr' ? 'qr' : 'link';
  // Un batch es una sola transacción: el INSERT solo corre si el UPDATE
  // condicional tocó la fila (changes() = 1), sin ventana entre chequeo y acción.
  const [update, , total] = await getClient().batch(
    [
      {
        sql: 'UPDATE links SET clicks = clicks + 1, qr_scans = qr_scans + ? WHERE id = ? AND (max_clicks IS NULL OR clicks < max_clicks)',
        args: [source === 'qr' ? 1 : 0, linkId],
      },
      {
        sql: `INSERT INTO clicks (link_id, referrer, country, device, browser, os, source, variant, city, region, referrer_url)
              SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
        args: [
          linkId,
          ctx.referrer,
          ctx.country,
          ctx.device,
          ctx.browser,
          ctx.os,
          source,
          opts.variant ?? null,
          ctx.city ?? null,
          ctx.region ?? null,
          ctx.referrerUrl ?? null,
        ],
      },
      { sql: 'SELECT clicks FROM links WHERE id = ?', args: [linkId] },
    ],
    'write',
  );
  if (update.rowsAffected !== 1) return null;
  return Number(total.rows[0]?.clicks ?? 0);
}

export async function todayClicksForLink(linkId: string): Promise<number> {
  return (
    (await getDb()
      .prepare(`SELECT COUNT(*) AS c FROM clicks WHERE link_id = ? AND ts >= date('now')`)
      .get(linkId)) as { c: number }
  ).c;
}

// ---------- Click log ----------

export interface ListClicksParams {
  range: AnalyticsRange;
  country?: string;
  page?: number;
  pageSize?: number;
}

export interface ListClicksResult {
  clicks: ClickRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listClicks(
  linkId: string,
  createdAt: string,
  params: ListClicksParams,
): Promise<ListClicksResult> {
  const db = getDb();
  const start = rangeStart(params.range, createdAt);

  const where: string[] = ['link_id = ? AND ts >= ?'];
  const args: Array<string | number> = [linkId, start];

  if (params.country) {
    where.push('country = ?');
    args.push(params.country);
  }

  const whereSql = where.join(' AND ');
  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), 100);
  const total = (
    (await db.prepare(`SELECT COUNT(*) AS c FROM clicks WHERE ${whereSql}`).get(...args)) as {
      c: number;
    }
  ).c;
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(params.page ?? 1, 1), pages);

  const clicks = (await db
    .prepare(`SELECT * FROM clicks WHERE ${whereSql} ORDER BY ts DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize)) as ClickRow[];

  return { clicks, total, page, pageSize };
}

/** Tope de filas de un export de clicks (memoria y tiempo en serverless). */
export const EXPORT_LIMIT = 100_000;

/** Los clicks del rango/país, del más nuevo al más viejo (como mucho `limit`). */
export async function exportClicks(
  linkId: string,
  createdAt: string,
  params: Pick<ListClicksParams, 'range' | 'country'>,
  limit: number = EXPORT_LIMIT,
): Promise<ClickRow[]> {
  const start = rangeStart(params.range, createdAt);
  const where: string[] = ['link_id = ? AND ts >= ?'];
  const args: Array<string | number> = [linkId, start];

  if (params.country) {
    where.push('country = ?');
    args.push(params.country);
  }

  return (await getDb()
    .prepare(`SELECT * FROM clicks WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT ?`)
    .all(...args, limit)) as ClickRow[];
}

export function clicksToCsv(clicks: ClickRow[]): string {
  const lines = ['timestamp,country,referrer,device,browser,os,source,variant,region,city,referrer_url'];
  for (const c of clicks) {
    lines.push(
      [
        csvCell(c.ts),
        csvCell(c.country ?? ''),
        csvCell(c.referrer ?? ''),
        csvCell(c.device ?? ''),
        csvCell(c.browser ?? ''),
        csvCell(c.os ?? ''),
        csvCell(c.source ?? 'link'),
        csvCell(c.variant ?? ''),
        csvCell(c.region ?? ''),
        csvCell(c.city ?? ''),
        csvCell(c.referrer_url ?? ''),
      ].join(','),
    );
  }
  return lines.join('\n');
}

/** All distinct countries recorded for a link, useful for click-log filters. */
export async function getClickCountries(linkId: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare('SELECT DISTINCT country FROM clicks WHERE link_id = ? ORDER BY country')
    .all(linkId)) as Array<{ country: string | null }>;
  return rows.map((r) => r.country).filter((c): c is string => !!c);
}

/** Un valor que empieza con = + - @ (o tab/CR) se abre como fórmula en Excel/Sheets: se neutraliza con '. */
export function csvSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string): string {
  const escaped = csvSafe(value).replace(/"/g, '""');
  if (/[",\n\r]/.test(escaped)) return `"${escaped}"`;
  return escaped;
}

// ---------- Date helpers ----------

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of YYYY-MM-DD dates from start to end. */
export function dayList(start: string, end: string): string[] {
  const out: string[] = [];
  let d = start;
  while (d <= end) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

// ---------- Analytics ----------

export interface DayCount {
  date: string;
  count: number;
}

export interface BreakdownItem {
  name: string;
  count: number;
}

export type AnalyticsRange = '7d' | '30d' | '90d' | 'all';

export function parseRange(raw: string | null | undefined): AnalyticsRange {
  return raw === '7d' || raw === '90d' || raw === 'all' ? raw : '30d';
}

const RANGE_DAYS: Record<Exclude<AnalyticsRange, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

export interface AnalyticsResult {
  total: number;
  rangeTotal: number;
  /** Clicks del período anterior de igual largo (null en "all"). */
  previousTotal: number | null;
  byDay: DayCount[];
  referrers: BreakdownItem[];
  countries: BreakdownItem[];
  devices: BreakdownItem[];
  browsers: BreakdownItem[];
  os: BreakdownItem[];
  /** Destino servido por la segmentación (ab:A, rule:1, app:ios); vacío sin targeting. */
  variants: BreakdownItem[];
  /** "Ciudad|PAÍS" (ver splitCityKey); sin ciudad cuenta como unknown. */
  cities: BreakdownItem[];
  /** "PAÍS-REGIÓN" (ISO 3166-2). */
  regions: BreakdownItem[];
  /** URLs completas del referrer (sin query salvo utm_*). */
  referrerUrls: BreakdownItem[];
}

/** Clave de ciudad de los breakdowns: "Córdoba|AR" → { city, country }. */
export function splitCityKey(key: string): { city: string; country: string | null } {
  const i = key.lastIndexOf('|');
  if (i < 0) return { city: key, country: null };
  return { city: key.slice(0, i), country: key.slice(i + 1) || null };
}

export function rangeStart(range: AnalyticsRange, createdAt: string): string {
  const end = todayUtc();
  if (range === 'all') return createdAt.slice(0, 10);
  return addDays(end, -(RANGE_DAYS[range] - 1));
}

type BreakdownColumn = 'referrer' | 'country' | 'device' | 'browser' | 'os' | 'variant' | 'city' | 'region' | 'referrer_url';

/** Expresión SQL de cada breakdown: ciudad y región llevan el país (hay Córdoba en AR y en ES). */
export const BREAKDOWN_SQL: Record<BreakdownColumn, string> = {
  referrer: 'referrer',
  country: 'country',
  device: 'device',
  browser: 'browser',
  os: 'os',
  variant: 'variant',
  city: "CASE WHEN city IS NULL THEN NULL ELSE city || '|' || COALESCE(country, '') END",
  region: "CASE WHEN region IS NULL THEN NULL ELSE COALESCE(country, '') || '-' || region END",
  referrer_url: 'referrer_url',
};

/** Top N values of a clicks column, folding the rest into "other". */
async function breakdown(
  linkId: string,
  column: BreakdownColumn,
  start: string,
  fallback: string,
  limit = 8,
): Promise<BreakdownItem[]> {
  const expr = BREAKDOWN_SQL[column];
  const rows = (await getDb()
    .prepare(
      `SELECT COALESCE(${expr}, ?) AS name, COUNT(*) AS c FROM clicks
       WHERE link_id = ? AND ts >= ? GROUP BY name ORDER BY c DESC, name`,
    )
    .all(fallback, linkId, start)) as Array<{ name: string; c: number }>;
  const top = rows.slice(0, limit).map((r) => ({ name: r.name, count: r.c }));
  const rest = rows.slice(limit).reduce((sum, r) => sum + r.c, 0);
  if (rest > 0) top.push({ name: 'other', count: rest });
  return top;
}

async function byDayFor(linkId: string, start: string, end: string): Promise<DayCount[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT date(ts) AS d, COUNT(*) AS c FROM clicks
       WHERE link_id = ? AND ts >= ? GROUP BY date(ts)`,
    )
    .all(linkId, start)) as Array<{ d: string; c: number }>;
  const map = new Map(rows.map((r) => [r.d, r.c]));
  return dayList(start, end).map((date) => ({ date, count: map.get(date) ?? 0 }));
}

export async function getAnalytics(
  linkId: string,
  createdAt: string,
  range: AnalyticsRange,
): Promise<AnalyticsResult> {
  const db = getDb();
  const end = todayUtc();
  const start = rangeStart(range, createdAt);

  const count = async (sql: string, ...args: string[]) =>
    ((await db.prepare(sql).get(...args)) as { c: number }).c;

  // Consultas independientes en paralelo: con Turso cada una es un viaje de red.
  const [total, rangeTotal, previousTotal, byDay, referrers, countries, devices, browsers, os, variants, cities, regions, referrerUrls] =
    await Promise.all([
      count('SELECT COUNT(*) AS c FROM clicks WHERE link_id = ?', linkId),
      count('SELECT COUNT(*) AS c FROM clicks WHERE link_id = ? AND ts >= ?', linkId, start),
      range === 'all'
        ? Promise.resolve(null)
        : count(
            'SELECT COUNT(*) AS c FROM clicks WHERE link_id = ? AND ts >= ? AND ts < ?',
            linkId,
            addDays(start, -RANGE_DAYS[range]),
            start,
          ),
      byDayFor(linkId, start, end),
      breakdown(linkId, 'referrer', start, 'direct'),
      breakdown(linkId, 'country', start, 'unknown'),
      breakdown(linkId, 'device', start, 'unknown'),
      breakdown(linkId, 'browser', start, 'unknown'),
      breakdown(linkId, 'os', start, 'unknown'),
      breakdown(linkId, 'variant', start, 'default'),
      breakdown(linkId, 'city', start, 'unknown'),
      breakdown(linkId, 'region', start, 'unknown'),
      breakdown(linkId, 'referrer_url', start, 'direct'),
    ]);

  return {
    total,
    rangeTotal,
    previousTotal,
    byDay,
    referrers,
    countries,
    devices,
    browsers,
    os,
    variants,
    cities,
    regions,
    referrerUrls,
  };
}

// ---------- User-level overview ----------

export interface OverviewLink {
  id: string;
  slug: string;
  domain_hostname: string | null;
  url: string;
  title: string | null;
  clicks: number;
  created_at: string;
}

export interface UserOverview {
  activeLinks: number;
  totalClicks: number;
  clicksToday: number;
  topLink: { slug: string; clicks: number } | null;
  byDay: DayCount[];
  topLinks: OverviewLink[];
  recent: OverviewLink[];
}

export async function getUserOverview(userId: string): Promise<UserOverview> {
  const db = getDb();

  const activeLinks = (
    (await db
      .prepare('SELECT COUNT(*) AS c FROM links WHERE user_id = ? AND archived = 0')
      .get(userId)) as { c: number }
  ).c;
  const totalClicks = (
    (await db
      .prepare('SELECT COALESCE(SUM(clicks), 0) AS c FROM links WHERE user_id = ?')
      .get(userId)) as { c: number }
  ).c;
  const clicksToday = (
    (await db
      .prepare(
        `SELECT COUNT(*) AS c FROM clicks c JOIN links l ON c.link_id = l.id
         WHERE l.user_id = ? AND c.ts >= date('now')`,
      )
      .get(userId)) as { c: number }
  ).c;
  const topLink =
    ((await db
      .prepare(
        'SELECT slug, clicks FROM links WHERE user_id = ? AND clicks > 0 ORDER BY clicks DESC LIMIT 1',
      )
      .get(userId)) as { slug: string; clicks: number } | undefined) ?? null;

  const end = todayUtc();
  const start = addDays(end, -29);
  const rows = (await db
    .prepare(
      `SELECT date(c.ts) AS d, COUNT(*) AS c FROM clicks c JOIN links l ON c.link_id = l.id
       WHERE l.user_id = ? AND c.ts >= ? GROUP BY date(c.ts)`,
    )
    .all(userId, start)) as Array<{ d: string; c: number }>;
  const map = new Map(rows.map((r) => [r.d, r.c]));
  const byDay = dayList(start, end).map((date) => ({ date, count: map.get(date) ?? 0 }));

  const cols =
    'l.id, l.slug, l.url, l.title, l.clicks, l.created_at, d.hostname AS domain_hostname FROM links l LEFT JOIN link_domains d ON d.id = l.domain_id';
  const topLinks = (await db
    .prepare(`SELECT ${cols} WHERE l.user_id = ? ORDER BY l.clicks DESC LIMIT 5`)
    .all(userId)) as OverviewLink[];
  const recent = (await db
    .prepare(`SELECT ${cols} WHERE l.user_id = ? ORDER BY l.created_at DESC LIMIT 5`)
    .all(userId)) as OverviewLink[];

  return { activeLinks, totalClicks, clicksToday, topLink, byDay, topLinks, recent };
}
