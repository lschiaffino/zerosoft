import geoip from 'geoip-lite';
import UAParser from 'ua-parser-js';
import { getDb } from './db';

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

  let country = headers.get('cf-ipcountry') ?? headers.get('x-vercel-ip-country');
  if (!country) {
    const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (ip) country = geoip.lookup(ip)?.country ?? null;
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

export function recordClick(linkId: string, ctx: ClickContext): void {
  const db = getDb();
  const insert = db.prepare(
    'INSERT INTO clicks (link_id, referrer, country, device, browser, os) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const bump = db.prepare('UPDATE links SET clicks = clicks + 1 WHERE id = ?');
  db.transaction(() => {
    insert.run(linkId, ctx.referrer, ctx.country, ctx.device, ctx.browser, ctx.os);
    bump.run(linkId);
  })();
}

export function todayClicksForLink(linkId: string): number {
  return (
    getDb()
      .prepare(`SELECT COUNT(*) AS c FROM clicks WHERE link_id = ? AND date(ts) = date('now')`)
      .get(linkId) as { c: number }
  ).c;
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

export type AnalyticsRange = '7d' | '30d' | 'all';

export interface AnalyticsResult {
  total: number;
  rangeTotal: number;
  byDay: DayCount[];
  referrers: BreakdownItem[];
  countries: BreakdownItem[];
  devices: BreakdownItem[];
  browsers: BreakdownItem[];
  os: BreakdownItem[];
}

export function rangeStart(range: AnalyticsRange, createdAt: string): string {
  const end = todayUtc();
  if (range === 'all') return createdAt.slice(0, 10);
  return addDays(end, range === '7d' ? -6 : -29);
}

type BreakdownColumn = 'referrer' | 'country' | 'device' | 'browser' | 'os';

/** Top N values of a clicks column, folding the rest into "other". */
function breakdown(
  linkId: string,
  column: BreakdownColumn,
  start: string,
  fallback: string,
  limit = 8,
): BreakdownItem[] {
  const rows = getDb()
    .prepare(
      `SELECT COALESCE(${column}, ?) AS name, COUNT(*) AS c FROM clicks
       WHERE link_id = ? AND date(ts) >= ? GROUP BY ${column} ORDER BY c DESC`,
    )
    .all(fallback, linkId, start) as Array<{ name: string; c: number }>;
  const top = rows.slice(0, limit).map((r) => ({ name: r.name, count: r.c }));
  const rest = rows.slice(limit).reduce((sum, r) => sum + r.c, 0);
  if (rest > 0) top.push({ name: 'other', count: rest });
  return top;
}

function byDayFor(linkId: string, start: string, end: string): DayCount[] {
  const rows = getDb()
    .prepare(
      `SELECT date(ts) AS d, COUNT(*) AS c FROM clicks
       WHERE link_id = ? AND date(ts) >= ? GROUP BY date(ts)`,
    )
    .all(linkId, start) as Array<{ d: string; c: number }>;
  const map = new Map(rows.map((r) => [r.d, r.c]));
  return dayList(start, end).map((date) => ({ date, count: map.get(date) ?? 0 }));
}

export function getAnalytics(linkId: string, createdAt: string, range: AnalyticsRange): AnalyticsResult {
  const db = getDb();
  const end = todayUtc();
  const start = rangeStart(range, createdAt);

  const total = (
    db.prepare('SELECT COUNT(*) AS c FROM clicks WHERE link_id = ?').get(linkId) as { c: number }
  ).c;
  const rangeTotal = (
    db
      .prepare('SELECT COUNT(*) AS c FROM clicks WHERE link_id = ? AND date(ts) >= ?')
      .get(linkId, start) as { c: number }
  ).c;

  return {
    total,
    rangeTotal,
    byDay: byDayFor(linkId, start, end),
    referrers: breakdown(linkId, 'referrer', start, 'direct'),
    countries: breakdown(linkId, 'country', start, 'unknown'),
    devices: breakdown(linkId, 'device', start, 'unknown'),
    browsers: breakdown(linkId, 'browser', start, 'unknown'),
    os: breakdown(linkId, 'os', start, 'unknown'),
  };
}

// ---------- User-level overview ----------

export interface OverviewLink {
  id: string;
  slug: string;
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

export function getUserOverview(userId: string): UserOverview {
  const db = getDb();

  const activeLinks = (
    db
      .prepare('SELECT COUNT(*) AS c FROM links WHERE user_id = ? AND archived = 0')
      .get(userId) as { c: number }
  ).c;
  const totalClicks = (
    db
      .prepare('SELECT COALESCE(SUM(clicks), 0) AS c FROM links WHERE user_id = ?')
      .get(userId) as { c: number }
  ).c;
  const clicksToday = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM clicks c JOIN links l ON c.link_id = l.id
         WHERE l.user_id = ? AND date(c.ts) = date('now')`,
      )
      .get(userId) as { c: number }
  ).c;
  const topLink =
    (db
      .prepare(
        'SELECT slug, clicks FROM links WHERE user_id = ? AND clicks > 0 ORDER BY clicks DESC LIMIT 1',
      )
      .get(userId) as { slug: string; clicks: number } | undefined) ?? null;

  const end = todayUtc();
  const start = addDays(end, -29);
  const rows = db
    .prepare(
      `SELECT date(c.ts) AS d, COUNT(*) AS c FROM clicks c JOIN links l ON c.link_id = l.id
       WHERE l.user_id = ? AND date(c.ts) >= ? GROUP BY date(c.ts)`,
    )
    .all(userId, start) as Array<{ d: string; c: number }>;
  const map = new Map(rows.map((r) => [r.d, r.c]));
  const byDay = dayList(start, end).map((date) => ({ date, count: map.get(date) ?? 0 }));

  const cols = 'id, slug, url, title, clicks, created_at';
  const topLinks = db
    .prepare(`SELECT ${cols} FROM links WHERE user_id = ? ORDER BY clicks DESC LIMIT 5`)
    .all(userId) as OverviewLink[];
  const recent = db
    .prepare(`SELECT ${cols} FROM links WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`)
    .all(userId) as OverviewLink[];

  return { activeLinks, totalClicks, clicksToday, topLink, byDay, topLinks, recent };
}
