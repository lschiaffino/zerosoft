import UAParser from 'ua-parser-js';
import { ensureMigrated, getClient, getDb, type ClickRow } from './db';

// geoip-lite preloads su .dat con fs al importarse: en Vercel el bundle no lo
// incluye y rompe el módulo entero (ENOENT). Se carga lazy y a prueba de fallos —
// en Vercel el país llega por header (x-vercel-ip-country) y nunca se requiere;
// en self-host el archivo existe y funciona como antes.
type GeoipLite = typeof import('geoip-lite');
let _geoip: GeoipLite | null | undefined;

function geoipCountry(ip: string): string | null {
  if (_geoip === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      _geoip = require('geoip-lite') as GeoipLite;
    } catch {
      _geoip = null;
    }
  }
  try {
    return _geoip?.lookup(ip)?.country ?? null;
  } catch {
    return null;
  }
}

// ---------- Click capture ----------

export interface ClickContext {
  referrer: string;
  country: string | null;
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
  if (!country && !process.env.VERCEL) {
    const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (ip) country = geoipCountry(ip);
  }

  const ua = new UAParser(headers.get('user-agent') ?? '').getResult();
  const deviceType = ua.device.type;

  return {
    referrer,
    country: country ?? null,
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
        sql: `INSERT INTO clicks (link_id, referrer, country, device, browser, os, source, variant)
              SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
        args: [linkId, ctx.referrer, ctx.country, ctx.device, ctx.browser, ctx.os, source, opts.variant ?? null],
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
  const lines = ['timestamp,country,referrer,device,browser,os,source,variant'];
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
}

export function rangeStart(range: AnalyticsRange, createdAt: string): string {
  const end = todayUtc();
  if (range === 'all') return createdAt.slice(0, 10);
  return addDays(end, -(RANGE_DAYS[range] - 1));
}

type BreakdownColumn = 'referrer' | 'country' | 'device' | 'browser' | 'os' | 'variant';

/** Top N values of a clicks column, folding the rest into "other". */
async function breakdown(
  linkId: string,
  column: BreakdownColumn,
  start: string,
  fallback: string,
  limit = 8,
): Promise<BreakdownItem[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT COALESCE(${column}, ?) AS name, COUNT(*) AS c FROM clicks
       WHERE link_id = ? AND ts >= ? GROUP BY ${column} ORDER BY c DESC`,
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

  const total = (
    (await db.prepare('SELECT COUNT(*) AS c FROM clicks WHERE link_id = ?').get(linkId)) as {
      c: number;
    }
  ).c;
  const rangeTotal = (
    (await db
      .prepare('SELECT COUNT(*) AS c FROM clicks WHERE link_id = ? AND ts >= ?')
      .get(linkId, start)) as { c: number }
  ).c;

  let previousTotal: number | null = null;
  if (range !== 'all') {
    const prevStart = addDays(start, -RANGE_DAYS[range]);
    previousTotal = (
      (await db
        .prepare('SELECT COUNT(*) AS c FROM clicks WHERE link_id = ? AND ts >= ? AND ts < ?')
        .get(linkId, prevStart, start)) as { c: number }
    ).c;
  }

  return {
    total,
    rangeTotal,
    previousTotal,
    byDay: await byDayFor(linkId, start, end),
    referrers: await breakdown(linkId, 'referrer', start, 'direct'),
    countries: await breakdown(linkId, 'country', start, 'unknown'),
    devices: await breakdown(linkId, 'device', start, 'unknown'),
    browsers: await breakdown(linkId, 'browser', start, 'unknown'),
    os: await breakdown(linkId, 'os', start, 'unknown'),
    variants: await breakdown(linkId, 'variant', start, 'default'),
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
