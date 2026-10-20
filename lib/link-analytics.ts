import { getDb } from './db';
import { csvSafe, dayList, EXPORT_LIMIT, type BreakdownItem } from './track';
import { shortUrl } from './utils';

/**
 * Analytics de todos los links del workspace (el usuario dueño). Las visitas
 * se separan en clics (source = 'link') y escaneos del QR (source = 'qr').
 * Filtra por `c.ts` en rango ([from, to+1d)) para usar idx_clicks_link_ts*:
 * por cada link del usuario, un range scan sobre sus clicks.
 */

export const MAX_RANGE_DAYS = 366;
export { EXPORT_LIMIT };

export interface WorkspaceRange {
  from: string;
  to: string;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function validDay(v: string | null | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/** Rango válido: por defecto los últimos 30 días; máximo 366; from <= to. */
export function parseWorkspaceRange(
  from: string | null | undefined,
  to: string | null | undefined,
  today = new Date().toISOString().slice(0, 10),
): WorkspaceRange {
  let end = validDay(to) ?? today;
  let start = validDay(from) ?? addDays(end, -29);
  if (start > end) [start, end] = [end, start];
  if (dayList(start, end).length > MAX_RANGE_DAYS) start = addDays(end, -(MAX_RANGE_DAYS - 1));
  return { from: start, to: end };
}

export interface WorkspaceDay {
  date: string;
  clicks: number;
  scans: number;
}

export interface WorkspaceTopLink {
  id: string;
  slug: string;
  short_url: string;
  url: string;
  title: string | null;
  clicks: number;
  scans: number;
}

export interface WorkspaceAnalytics {
  range: WorkspaceRange;
  clicks: number;
  scans: number;
  previous: { clicks: number; scans: number };
  byDay: WorkspaceDay[];
  topLinks: WorkspaceTopLink[];
  referrers: BreakdownItem[];
  countries: BreakdownItem[];
  devices: BreakdownItem[];
  browsers: BreakdownItem[];
  /** "Ciudad|PAÍS" (ver splitCityKey en lib/track.ts). */
  cities: BreakdownItem[];
}

const FROM = 'FROM clicks c JOIN links l ON l.id = c.link_id';
const WHERE = 'l.user_id = ? AND c.ts >= ? AND c.ts < ?';

type Col = 'referrer' | 'country' | 'device' | 'browser' | 'city';

const COL_SQL: Record<Col, string> = {
  referrer: 'c.referrer',
  country: 'c.country',
  device: 'c.device',
  browser: 'c.browser',
  city: "CASE WHEN c.city IS NULL THEN NULL ELSE c.city || '|' || COALESCE(c.country, '') END",
};

export async function getWorkspaceAnalytics(userId: string, range: WorkspaceRange): Promise<WorkspaceAnalytics> {
  const db = getDb();
  const lo = range.from;
  const hi = addDays(range.to, 1);
  const args = [userId, lo, hi];

  type SourceRows = Array<{ s: string; n: number }>;
  const len = dayList(range.from, range.to).length;
  const bySource = `SELECT c.source AS s, COUNT(*) AS n ${FROM} WHERE ${WHERE} GROUP BY c.source`;

  const breakdown = async (col: Col, fallback: string, limit = 8): Promise<BreakdownItem[]> => {
    const rows = (await db
      .prepare(
        `SELECT COALESCE(${COL_SQL[col]}, ?) AS name, COUNT(*) AS n ${FROM} WHERE ${WHERE} GROUP BY name ORDER BY n DESC, name`,
      )
      .all(fallback, ...args)) as Array<{ name: string; n: number }>;
    const out = rows.slice(0, limit).map((r) => ({ name: r.name, count: Number(r.n) }));
    const rest = rows.slice(limit).reduce((a, r) => a + Number(r.n), 0);
    if (rest > 0) out.push({ name: 'other', count: rest });
    return out;
  };

  // Consultas independientes en paralelo: con Turso cada una es un viaje de red.
  const [totals, prevRows, dayRows, top, referrers, countries, devices, browsers, cities] = await Promise.all([
    db.prepare(bySource).all(...args) as Promise<SourceRows>,
    db.prepare(bySource).all(userId, addDays(range.from, -len), lo) as Promise<SourceRows>,
    db
      .prepare(
        `SELECT substr(c.ts, 1, 10) AS d, SUM(c.source = 'qr') AS q, COUNT(*) AS n ${FROM} WHERE ${WHERE} GROUP BY d`,
      )
      .all(...args) as Promise<Array<{ d: string; q: number; n: number }>>,
    db
      .prepare(
        `SELECT l.id, l.slug, l.url, l.title, d.hostname AS host,
                COUNT(*) AS n, SUM(c.source = 'qr') AS q
         ${FROM} LEFT JOIN link_domains d ON d.id = l.domain_id
         WHERE ${WHERE} GROUP BY l.id ORDER BY n DESC, l.slug LIMIT 10`,
      )
      .all(...args) as Promise<
      Array<{ id: string; slug: string; url: string; title: string | null; host: string | null; n: number; q: number }>
    >,
    breakdown('referrer', 'direct'),
    breakdown('country', 'unknown'),
    breakdown('device', 'unknown'),
    breakdown('browser', 'unknown'),
    breakdown('city', 'unknown'),
  ]);

  const sum = (rows: SourceRows) => ({
    clicks: rows.filter((r) => r.s !== 'qr').reduce((a, r) => a + Number(r.n), 0),
    scans: rows.filter((r) => r.s === 'qr').reduce((a, r) => a + Number(r.n), 0),
  });
  const map = new Map(dayRows.map((r) => [r.d, r]));
  const byDay = dayList(range.from, range.to).map((date) => {
    const r = map.get(date);
    const scans = Number(r?.q ?? 0);
    return { date, clicks: Number(r?.n ?? 0) - scans, scans };
  });

  return {
    range,
    ...sum(totals),
    previous: sum(prevRows),
    byDay,
    topLinks: top.map((r) => ({
      id: r.id,
      slug: r.slug,
      short_url: shortUrl(r.slug, r.host),
      url: r.url,
      title: r.title,
      clicks: Number(r.n) - Number(r.q ?? 0),
      scans: Number(r.q ?? 0),
    })),
    referrers,
    countries,
    devices,
    browsers,
    cities,
  };
}

export interface WorkspaceClickRow {
  ts: string;
  slug: string;
  short_url: string;
  source: string;
  variant: string | null;
  country: string | null;
  referrer: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  region?: string | null;
  city?: string | null;
  referrer_url?: string | null;
}

export async function exportWorkspaceClicks(userId: string, range: WorkspaceRange): Promise<WorkspaceClickRow[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT c.ts, l.slug, d.hostname AS host, c.source, c.variant, c.country, c.referrer, c.device, c.browser, c.os,
              c.region, c.city, c.referrer_url
       ${FROM} LEFT JOIN link_domains d ON d.id = l.domain_id
       WHERE ${WHERE} ORDER BY c.ts DESC LIMIT ${EXPORT_LIMIT}`,
    )
    .all(userId, range.from, addDays(range.to, 1))) as Array<Omit<WorkspaceClickRow, 'short_url'> & { host: string | null }>;
  return rows.map(({ host, ...r }) => ({ ...r, short_url: shortUrl(r.slug, host) }));
}

function cell(v: string | null): string {
  const s = csvSafe(v ?? '').replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

export function workspaceClicksToCsv(rows: WorkspaceClickRow[]): string {
  const lines = ['timestamp,short_url,source,variant,country,referrer,device,browser,os,region,city,referrer_url'];
  for (const r of rows) {
    lines.push(
      [
        r.ts,
        r.short_url,
        r.source,
        r.variant,
        r.country,
        r.referrer,
        r.device,
        r.browser,
        r.os,
        r.region ?? null,
        r.city ?? null,
        r.referrer_url ?? null,
      ]
        .map(cell)
        .join(','),
    );
  }
  return lines.join('\n');
}
