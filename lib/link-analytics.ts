import { getDb } from './db';
import { csvSafe, dayList, EXPORT_LIMIT, type BreakdownItem } from './track';
import { shortUrl } from './utils';
import { isValidTimeZone, tzOffsetMinutes } from './user-tz';
import { visibleLinksSql, type LinkViewer } from './link-folders';

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
  /** Zona en la que se cortan los días del rango. */
  timezone: string;
  filters: WorkspaceFilters;
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

// ---------- Filtros y zona horaria ----------

export const DEVICE_FILTERS = ['desktop', 'mobile', 'tablet'] as const;

/** Filtros de las analytics del workspace (todos opcionales, se combinan con AND). */
export interface WorkspaceFilters {
  tag?: string;
  /** Id de un dominio propio, o 'default' para el dominio de zerosoft. */
  domain?: string;
  /** Id de un link. */
  link?: string;
  /** ISO 3166-1 alpha-2 en mayúsculas. */
  country?: string;
  device?: (typeof DEVICE_FILTERS)[number];
  /** Id de una carpeta, o 'none' para los links sin carpeta. */
  folder?: string;
}

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function param(src: ParamSource, key: string): string | undefined {
  const v = src instanceof URLSearchParams ? src.get(key) : src[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Filtros válidos de una query (?tag=&domain=&link=&country=&device=&folder=); lo inválido se ignora. */
export function parseWorkspaceFilters(src: ParamSource): WorkspaceFilters {
  const out: WorkspaceFilters = {};
  const tag = param(src, 'tag');
  if (tag && tag.length <= 40) out.tag = tag;
  const domain = param(src, 'domain');
  if (domain && domain.length <= 64) out.domain = domain;
  const link = param(src, 'link');
  if (link && link.length <= 64) out.link = link;
  const country = param(src, 'country')?.toUpperCase();
  if (country && /^[A-Z]{2}$/.test(country)) out.country = country;
  const device = param(src, 'device');
  if (device && (DEVICE_FILTERS as readonly string[]).includes(device)) out.device = device as WorkspaceFilters['device'];
  const folder = param(src, 'folder');
  if (folder && folder.length <= 64) out.folder = folder;
  return out;
}

/** Los filtros como query (para links de export o de la página pública). */
export function filtersQuery(filters: WorkspaceFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) if (v) out[k] = v;
  return out;
}

/** Zona IANA válida o UTC. */
export function parseTimezone(tz: string | null | undefined): string {
  if (!tz || tz.length > 64) return 'UTC';
  return isValidTimeZone(tz) ? tz : 'UTC';
}

function sqlTs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/** Instante UTC (ms) de la medianoche local de `date` en `tz`. */
export function localMidnightUtc(date: string, tz: string): number {
  const base = Date.parse(`${date}T00:00:00Z`);
  // Dos pasadas: la segunda corrige si el offset cambia entre la estimación y el resultado (DST).
  let ms = base - tzOffsetMinutes(tz, new Date(base)) * 60_000;
  ms = base - tzOffsetMinutes(tz, new Date(ms)) * 60_000;
  return ms;
}

/**
 * Tramos de offset de `tz` entre `fromMs` y `toMs`: el offset (minutos) vale
 * hasta `until` (ms, exclusivo). Recorre de a un día y, si el offset cambia,
 * busca el minuto exacto del cambio.
 */
export function offsetSegments(tz: string, fromMs: number, toMs: number): Array<{ until: number; offset: number }> {
  const off = (ms: number) => tzOffsetMinutes(tz, new Date(ms));
  const out: Array<{ until: number; offset: number }> = [];
  const DAY = 86_400_000;
  let cur = fromMs;
  let curOff = off(cur);
  for (let t = fromMs + DAY; ; t += DAY) {
    const probe = Math.min(t, toMs);
    const o = off(probe);
    if (o !== curOff) {
      let lo = probe - DAY > cur ? probe - DAY : cur;
      let hi = probe;
      while (hi - lo > 60_000) {
        const mid = lo + Math.floor((hi - lo) / 2 / 60_000) * 60_000;
        if (off(mid) === curOff) lo = mid;
        else hi = mid;
      }
      out.push({ until: hi, offset: curOff });
      cur = hi;
      curOff = o;
    }
    if (probe >= toMs) break;
  }
  out.push({ until: toMs, offset: curOff });
  return out;
}

const modifier = (offset: number) => `${offset >= 0 ? '+' : ''}${offset} minutes`;

/**
 * Expresión SQL del día local (YYYY-MM-DD) de c.ts en `tz` para [loMs, hiMs).
 * En UTC es el prefijo de la columna; si no, se corre por el offset de cada tramo.
 */
function localDaySql(tz: string, loMs: number, hiMs: number): { sql: string; args: string[] } {
  if (tz === 'UTC') return { sql: 'substr(c.ts, 1, 10)', args: [] };
  const segs = offsetSegments(tz, loMs, hiMs);
  if (segs.length === 1) return { sql: 'substr(datetime(c.ts, ?), 1, 10)', args: [modifier(segs[0].offset)] };
  const args: string[] = [];
  const whens = segs.slice(0, -1).map((seg) => {
    args.push(sqlTs(seg.until), modifier(seg.offset));
    return 'WHEN c.ts < ? THEN ?';
  });
  args.push(modifier(segs[segs.length - 1].offset));
  return { sql: `substr(datetime(c.ts, CASE ${whens.join(' ')} ELSE ? END), 1, 10)`, args };
}

/** Condiciones de los filtros (alias l = links, c = clicks). */
function filterSql(filters: WorkspaceFilters): { sql: string; args: string[] } {
  const parts: string[] = [];
  const args: string[] = [];
  if (filters.tag) {
    parts.push(`EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(l.tags) THEN l.tags ELSE '[]' END) j WHERE j.value = ?)`);
    args.push(filters.tag);
  }
  if (filters.domain === 'default') parts.push('l.domain_id IS NULL');
  else if (filters.domain) {
    parts.push('l.domain_id = ?');
    args.push(filters.domain);
  }
  if (filters.link) {
    parts.push('l.id = ?');
    args.push(filters.link);
  }
  if (filters.country) {
    parts.push('c.country = ?');
    args.push(filters.country);
  }
  if (filters.device) {
    parts.push('c.device = ?');
    args.push(filters.device);
  }
  if (filters.folder === 'none') parts.push('l.folder_id IS NULL');
  else if (filters.folder) {
    parts.push('l.folder_id = ?');
    args.push(filters.folder);
  }
  return { sql: parts.map((p) => ` AND ${p}`).join(''), args };
}

export interface WorkspaceAnalyticsOptions {
  filters?: WorkspaceFilters;
  /** Zona IANA en la que se cortan los días (default UTC). */
  timezone?: string;
  /** Quién mira: los links de carpetas que no ve no cuentan. */
  viewer?: LinkViewer;
}

const FROM = 'FROM clicks c JOIN links l ON l.id = c.link_id';

type Col = 'referrer' | 'country' | 'device' | 'browser' | 'city';

const COL_SQL: Record<Col, string> = {
  referrer: 'c.referrer',
  country: 'c.country',
  device: 'c.device',
  browser: 'c.browser',
  city: "CASE WHEN c.city IS NULL THEN NULL ELSE c.city || '|' || COALESCE(c.country, '') END",
};

/** WHERE del workspace en [lo, hi) con filtros y visibilidad. */
function scopeSql(
  userId: string,
  lo: string,
  hi: string,
  opts: WorkspaceAnalyticsOptions,
): { sql: string; args: Array<string | number> } {
  const f = filterSql(opts.filters ?? {});
  const v = visibleLinksSql(opts.viewer);
  return {
    sql: `l.user_id = ? AND c.ts >= ? AND c.ts < ?${f.sql}${v.sql ? ` AND ${v.sql}` : ''}`,
    args: [userId, lo, hi, ...f.args, ...v.args],
  };
}

/** Bordes del rango en la zona: de la medianoche local de `from` a la del día siguiente a `to`. */
function rangeBounds(range: WorkspaceRange, tz: string): { loMs: number; hiMs: number; lo: string; hi: string } {
  const loMs = localMidnightUtc(range.from, tz);
  const hiMs = localMidnightUtc(addDays(range.to, 1), tz);
  return { loMs, hiMs, lo: sqlTs(loMs), hi: sqlTs(hiMs) };
}

export async function getWorkspaceAnalytics(
  userId: string,
  range: WorkspaceRange,
  opts: WorkspaceAnalyticsOptions = {},
): Promise<WorkspaceAnalytics> {
  const db = getDb();
  const timezone = parseTimezone(opts.timezone);
  const filters = opts.filters ?? {};
  const len = dayList(range.from, range.to).length;
  const cur = rangeBounds(range, timezone);
  const prev = rangeBounds({ from: addDays(range.from, -len), to: addDays(range.from, -1) }, timezone);
  const scope = scopeSql(userId, cur.lo, cur.hi, opts);
  const prevScope = scopeSql(userId, prev.lo, prev.hi, opts);
  const day = localDaySql(timezone, cur.loMs, cur.hiMs);

  type SourceRows = Array<{ s: string; n: number }>;
  const bySource = (w: { sql: string }) => `SELECT c.source AS s, COUNT(*) AS n ${FROM} WHERE ${w.sql} GROUP BY c.source`;

  const breakdown = async (col: Col, fallback: string, limit = 8): Promise<BreakdownItem[]> => {
    const rows = (await db
      .prepare(
        `SELECT COALESCE(${COL_SQL[col]}, ?) AS name, COUNT(*) AS n ${FROM} WHERE ${scope.sql} GROUP BY name ORDER BY n DESC, name`,
      )
      .all(fallback, ...scope.args)) as Array<{ name: string; n: number }>;
    const out = rows.slice(0, limit).map((r) => ({ name: r.name, count: Number(r.n) }));
    const rest = rows.slice(limit).reduce((a, r) => a + Number(r.n), 0);
    if (rest > 0) out.push({ name: 'other', count: rest });
    return out;
  };

  // Consultas independientes en paralelo: con Turso cada una es un viaje de red.
  const [totals, prevRows, dayRows, top, referrers, countries, devices, browsers, cities] = await Promise.all([
    db.prepare(bySource(scope)).all(...scope.args) as Promise<SourceRows>,
    db.prepare(bySource(prevScope)).all(...prevScope.args) as Promise<SourceRows>,
    db
      .prepare(`SELECT ${day.sql} AS d, SUM(c.source = 'qr') AS q, COUNT(*) AS n ${FROM} WHERE ${scope.sql} GROUP BY d`)
      .all(...day.args, ...scope.args) as Promise<Array<{ d: string; q: number; n: number }>>,
    db
      .prepare(
        `SELECT l.id, l.slug, l.url, l.title, d.hostname AS host,
                COUNT(*) AS n, SUM(c.source = 'qr') AS q
         ${FROM} LEFT JOIN link_domains d ON d.id = l.domain_id
         WHERE ${scope.sql} GROUP BY l.id ORDER BY n DESC, l.slug LIMIT 10`,
      )
      .all(...scope.args) as Promise<
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
    timezone,
    filters,
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

// ---------- Conversiones (leads y ventas) ----------

export interface WorkspaceConversionDay {
  date: string;
  leads: number;
  sales: number;
}

export interface WorkspaceConversionLink {
  id: string;
  slug: string;
  short_url: string;
  leads: number;
  sales: number;
  /** Ingresos en la moneda principal (unidades menores). */
  revenue: number;
}

export interface WorkspaceConversions {
  leads: number;
  sales: number;
  /** Ingresos por moneda (unidades menores), la mayor primero. */
  revenue: Array<{ currency: string; amount: number }>;
  previous: { leads: number; sales: number };
  byDay: WorkspaceConversionDay[];
  topLinks: WorkspaceConversionLink[];
}

const CONV_FROM = 'FROM link_conversions c JOIN links l ON l.id = c.link_id';

/**
 * Leads, ventas e ingresos del workspace en el rango, con los mismos filtros
 * y visibilidad que los clicks (país y dispositivo son los del click que
 * convirtió).
 */
export async function getWorkspaceConversions(
  userId: string,
  range: WorkspaceRange,
  opts: WorkspaceAnalyticsOptions = {},
): Promise<WorkspaceConversions> {
  const db = getDb();
  const timezone = parseTimezone(opts.timezone);
  const len = dayList(range.from, range.to).length;
  const cur = rangeBounds(range, timezone);
  const prev = rangeBounds({ from: addDays(range.from, -len), to: addDays(range.from, -1) }, timezone);
  const scope = scopeSql(userId, cur.lo, cur.hi, opts);
  const prevScope = scopeSql(userId, prev.lo, prev.hi, opts);
  const day = localDaySql(timezone, cur.loMs, cur.hiMs);
  const [totals, prevRows, dayRows, top] = await Promise.all([
    db
      .prepare(`SELECT c.type AS type, c.currency AS currency, COUNT(*) AS n, SUM(c.amount) AS amount ${CONV_FROM} WHERE ${scope.sql} GROUP BY c.type, c.currency`)
      .all(...scope.args) as Promise<Array<{ type: string; currency: string | null; n: number; amount: number }>>,
    db
      .prepare(`SELECT c.type AS type, COUNT(*) AS n ${CONV_FROM} WHERE ${prevScope.sql} GROUP BY c.type`)
      .all(...prevScope.args) as Promise<Array<{ type: string; n: number }>>,
    db
      .prepare(`SELECT ${day.sql} AS d, SUM(c.type = 'lead') AS leads, SUM(c.type = 'sale') AS sales ${CONV_FROM} WHERE ${scope.sql} GROUP BY d`)
      .all(...day.args, ...scope.args) as Promise<Array<{ d: string; leads: number; sales: number }>>,
    db
      .prepare(
        `SELECT l.id, l.slug, d.hostname AS host, SUM(c.type = 'lead') AS leads, SUM(c.type = 'sale') AS sales,
                SUM(CASE WHEN c.type = 'sale' THEN c.amount ELSE 0 END) AS revenue
         ${CONV_FROM} LEFT JOIN link_domains d ON d.id = l.domain_id
         WHERE ${scope.sql} GROUP BY l.id ORDER BY revenue DESC, leads DESC, l.slug LIMIT 10`,
      )
      .all(...scope.args) as Promise<Array<{ id: string; slug: string; host: string | null; leads: number; sales: number; revenue: number }>>,
  ]);
  const revenue = new Map<string, number>();
  let leads = 0;
  let sales = 0;
  for (const r of totals) {
    if (r.type === 'lead') leads += Number(r.n);
    else {
      sales += Number(r.n);
      const c = r.currency ?? 'USD';
      revenue.set(c, (revenue.get(c) ?? 0) + Number(r.amount ?? 0));
    }
  }
  const map = new Map(dayRows.map((r) => [r.d, r]));
  return {
    leads,
    sales,
    revenue: [...revenue.entries()].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount),
    previous: {
      leads: Number(prevRows.find((r) => r.type === 'lead')?.n ?? 0),
      sales: Number(prevRows.find((r) => r.type === 'sale')?.n ?? 0),
    },
    byDay: dayList(range.from, range.to).map((date) => ({
      date,
      leads: Number(map.get(date)?.leads ?? 0),
      sales: Number(map.get(date)?.sales ?? 0),
    })),
    topLinks: top.map((r) => ({
      id: r.id,
      slug: r.slug,
      short_url: shortUrl(r.slug, r.host),
      leads: Number(r.leads ?? 0),
      sales: Number(r.sales ?? 0),
      revenue: Number(r.revenue ?? 0),
    })),
  };
}

export interface WorkspaceConversionRow {
  ts: string;
  type: string;
  event_name: string;
  short_url: string;
  customer_external_id: string | null;
  amount: number;
  currency: string | null;
  invoice_id: string | null;
  source: string;
  country: string | null;
  device: string | null;
}

/** Conversiones del rango para el CSV (sin nombre ni email del cliente). */
export async function exportWorkspaceConversions(
  userId: string,
  range: WorkspaceRange,
  opts: WorkspaceAnalyticsOptions = {},
): Promise<WorkspaceConversionRow[]> {
  const b = rangeBounds(range, parseTimezone(opts.timezone));
  const scope = scopeSql(userId, b.lo, b.hi, opts);
  const rows = (await getDb()
    .prepare(
      `SELECT c.ts, c.type, c.event_name, l.slug, d.hostname AS host, c.customer_external_id, c.amount, c.currency,
              c.invoice_id, c.source, c.country, c.device
       ${CONV_FROM} LEFT JOIN link_domains d ON d.id = l.domain_id
       WHERE ${scope.sql} ORDER BY c.ts DESC LIMIT ${EXPORT_LIMIT}`,
    )
    .all(...scope.args)) as Array<Omit<WorkspaceConversionRow, 'short_url'> & { slug: string; host: string | null }>;
  return rows.map(({ slug, host, ...r }) => ({ ...r, short_url: shortUrl(slug, host) }));
}

export function workspaceConversionsToCsv(rows: WorkspaceConversionRow[]): string {
  const lines = ['timestamp,type,event,short_url,customer_id,amount_minor,currency,invoice_id,source,country,device'];
  for (const r of rows) {
    lines.push(
      [r.ts, r.type, r.event_name, r.short_url, r.customer_external_id, String(r.amount ?? 0), r.currency, r.invoice_id, r.source, r.country, r.device]
        .map(cell)
        .join(','),
    );
  }
  return lines.join('\n');
}

export interface AnalyticsFacets {
  tags: string[];
  domains: Array<{ id: string; hostname: string }>;
  links: Array<{ id: string; label: string }>;
  countries: string[];
}

/** Opciones de los filtros: tags, dominios, los links más visitados y los países con visitas. */
export async function getAnalyticsFacets(userId: string, viewer?: LinkViewer): Promise<AnalyticsFacets> {
  const db = getDb();
  const v = visibleLinksSql(viewer);
  const vis = v.sql ? ` AND ${v.sql}` : '';
  const [tags, domains, links, countries] = await Promise.all([
    db
      .prepare(
        `SELECT DISTINCT j.value AS tag FROM links l,
           json_each(CASE WHEN json_valid(l.tags) THEN l.tags ELSE '[]' END) j
         WHERE l.user_id = ? AND j.type = 'text'${vis} LIMIT 500`,
      )
      .all(userId, ...v.args) as Promise<Array<{ tag: string }>>,
    db
      .prepare('SELECT id, hostname FROM link_domains WHERE user_id = ? AND verified = 1 ORDER BY hostname')
      .all(userId) as Promise<Array<{ id: string; hostname: string }>>,
    db
      .prepare(
        `SELECT l.id, l.slug, l.title, d.hostname AS host FROM links l LEFT JOIN link_domains d ON d.id = l.domain_id
         WHERE l.user_id = ?${vis} ORDER BY l.clicks DESC, l.created_at DESC LIMIT 200`,
      )
      .all(userId, ...v.args) as Promise<Array<{ id: string; slug: string; title: string | null; host: string | null }>>,
    db
      .prepare(
        `SELECT DISTINCT c.country AS country FROM clicks c JOIN links l ON l.id = c.link_id
         WHERE l.user_id = ? AND c.country IS NOT NULL AND c.ts >= datetime('now', '-366 days')${vis} LIMIT 300`,
      )
      .all(userId, ...v.args) as Promise<Array<{ country: string }>>,
  ]);
  return {
    tags: tags.map((r) => r.tag).sort(),
    domains,
    links: links.map((l) => ({ id: l.id, label: shortUrl(l.slug, l.host).replace(/^https?:\/\//, '') })),
    countries: countries.map((r) => r.country).filter((c) => /^[A-Z]{2}$/.test(c)).sort(),
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

export async function exportWorkspaceClicks(
  userId: string,
  range: WorkspaceRange,
  opts: WorkspaceAnalyticsOptions = {},
): Promise<WorkspaceClickRow[]> {
  const b = rangeBounds(range, parseTimezone(opts.timezone));
  const scope = scopeSql(userId, b.lo, b.hi, opts);
  const rows = (await getDb()
    .prepare(
      `SELECT c.ts, l.slug, d.hostname AS host, c.source, c.variant, c.country, c.referrer, c.device, c.browser, c.os,
              c.region, c.city, c.referrer_url
       ${FROM} LEFT JOIN link_domains d ON d.id = l.domain_id
       WHERE ${scope.sql} ORDER BY c.ts DESC LIMIT ${EXPORT_LIMIT}`,
    )
    .all(...scope.args)) as Array<Omit<WorkspaceClickRow, 'short_url'> & { host: string | null }>;
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
