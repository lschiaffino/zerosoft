/**
 * Extras de web analytics, la parte pura: canal de cada visita (función y el
 * mismo cálculo en SQL), filtros de la página y percentiles de web vitals.
 * Las listas de dominios son constantes: lo único que entra al SQL como literal.
 */
import { VITAL_METRICS, VITAL_THRESHOLDS, vitalRating, type ChannelKey, type VitalMetric, type VitalSummary, type VitalsResult, type WebFilter } from './more-types';
import type { Frag } from './sql-build';

export const EMAIL_DOMAINS = ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'mail.yahoo.com', 'mail.proton.me', 'mail.aol.com', 'mail.zoho.com'];
export const SEARCH_DOMAINS = ['bing.com', 'duckduckgo.com', 'yahoo.com', 'yandex.com', 'yandex.ru', 'baidu.com', 'ecosia.org', 'search.brave.com', 'naver.com', 'qwant.com', 'startpage.com', 'kagi.com', 'ask.com', 'aol.com', 'seznam.cz', 'sogou.com'];
export const SOCIAL_DOMAINS = ['facebook.com', 'instagram.com', 'threads.net', 'x.com', 'twitter.com', 't.co', 'linkedin.com', 'lnkd.in', 'youtube.com', 'youtu.be', 'tiktok.com', 'reddit.com', 'pinterest.com', 'snapchat.com', 'tumblr.com', 'bsky.app', 'mastodon.social', 'discord.com', 't.me', 'whatsapp.com', 'wa.me', 'quora.com', 'vk.com', 'news.ycombinator.com'];

const PAID_MEDIUMS = ['cpc', 'ppc', 'paid', 'paidsearch', 'paid-search', 'paid_search', 'sem', 'cpm', 'cpv', 'display', 'retargeting'];
const PAID_SOCIAL_MEDIUMS = ['paidsocial', 'paid-social', 'paid_social', 'social-paid', 'social_paid', 'psocial'];
const SOCIAL_MEDIUMS = ['social', 'social-network', 'social-media', 'sm', 'organic-social', 'organic_social'];
const EMAIL_VALUES = ['email', 'e-mail', 'e_mail', 'newsletter', 'mail'];
const SEARCH_SOURCES = ['google', 'bing', 'duckduckgo', 'yahoo', 'yandex', 'baidu', 'ecosia', 'brave', 'naver'];
const SOCIAL_SOURCES = ['facebook', 'fb', 'instagram', 'ig', 'threads', 'x', 'twitter', 'linkedin', 'youtube', 'tiktok', 'reddit', 'pinterest', 'snapchat', 'meta', 'bluesky', 'whatsapp', 'telegram'];
const PAID_SEARCH_CLICK = ['gclid=', 'gbraid=', 'wbraid=', 'msclkid='];
const PAID_SOCIAL_CLICK = ['ttclid=', 'twclid=', 'li_fat_id='];

const domainMatches = (d: string, list: readonly string[]) => list.some((x) => d === x || d.endsWith(`.${x}`));
/** google.com, google.com.ar, google.de… (no docs.google.com: ese es una referencia). */
const isGoogle = (d: string) => d.startsWith('google.');

export interface ChannelInput {
  referringDomain?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  url?: string | null;
}

/**
 * Canal de una visita, en orden: anuncios (utm_medium o id de click), email,
 * red social, buscador, referencia y directo. Tiene que dar lo mismo que channelSql.
 */
export function channelType(input: ChannelInput): ChannelKey {
  const d = (input.referringDomain ?? '').toLowerCase().trim();
  const domain = d === '$direct' ? '' : d;
  const source = (input.utmSource ?? '').toLowerCase().trim();
  const medium = (input.utmMedium ?? '').toLowerCase().trim();
  const url = (input.url ?? '').toLowerCase();
  const isSocial = domainMatches(domain, SOCIAL_DOMAINS) || SOCIAL_SOURCES.includes(source);
  if (PAID_SOCIAL_MEDIUMS.includes(medium) || PAID_SOCIAL_CLICK.some((c) => url.includes(c))) return 'paid_social';
  if (PAID_MEDIUMS.includes(medium)) return isSocial ? 'paid_social' : 'paid_search';
  if (PAID_SEARCH_CLICK.some((c) => url.includes(c))) return 'paid_search';
  if (EMAIL_VALUES.includes(medium) || EMAIL_VALUES.includes(source) || domainMatches(domain, EMAIL_DOMAINS)) return 'email';
  if (SOCIAL_MEDIUMS.includes(medium) || isSocial) return 'organic_social';
  if (medium === 'organic' || SEARCH_SOURCES.includes(source) || isGoogle(domain) || domainMatches(domain, SEARCH_DOMAINS)) return 'organic_search';
  if (domain || source || medium) return 'referral';
  return 'direct';
}

/** Literal SQL de las listas de arriba. Si alguien suma algo raro a una lista, falla en vez de armar SQL. */
const lit = (s: string) => {
  if (!/^[%a-z0-9._=-]+$/.test(s)) throw new Error('invalid_channel_literal');
  return `'${s}'`;
};
const inList = (expr: string, list: readonly string[]) => `${expr} IN (${list.map(lit).join(',')})`;
const domainSql = (d: string, list: readonly string[]) => `(${inList(d, list)} OR ${list.map((x) => `${d} LIKE ${lit(`%.${x}`)}`).join(' OR ')})`;
const urlAnySql = (u: string, list: readonly string[]) => `(${list.map((x) => `instr(${u}, ${lit(x)}) > 0`).join(' OR ')})`;

/** La misma cuenta que channelType, en SQL. */
export function channelSql(alias = 'e'): string {
  const d = `lower(trim(COALESCE(NULLIF(${alias}.referring_domain, '$direct'), '')))`;
  const s = `lower(trim(COALESCE(${alias}.utm_source, '')))`;
  const m = `lower(trim(COALESCE(${alias}.utm_medium, '')))`;
  const u = `lower(COALESCE(${alias}.url, ''))`;
  const social = `(${domainSql(d, SOCIAL_DOMAINS)} OR ${inList(s, SOCIAL_SOURCES)})`;
  return `(CASE
    WHEN ${inList(m, PAID_SOCIAL_MEDIUMS)} OR ${urlAnySql(u, PAID_SOCIAL_CLICK)} THEN 'paid_social'
    WHEN ${inList(m, PAID_MEDIUMS)} THEN CASE WHEN ${social} THEN 'paid_social' ELSE 'paid_search' END
    WHEN ${urlAnySql(u, PAID_SEARCH_CLICK)} THEN 'paid_search'
    WHEN ${inList(m, EMAIL_VALUES)} OR ${inList(s, EMAIL_VALUES)} OR ${domainSql(d, EMAIL_DOMAINS)} THEN 'email'
    WHEN ${inList(m, SOCIAL_MEDIUMS)} OR ${social} THEN 'organic_social'
    WHEN ${m} = 'organic' OR ${inList(s, SEARCH_SOURCES)} OR ${d} LIKE 'google.%' OR ${domainSql(d, SEARCH_DOMAINS)} THEN 'organic_search'
    WHEN ${d} != '' OR ${s} != '' OR ${m} != '' THEN 'referral'
    ELSE 'direct' END)`;
}

const FILTER_COLUMNS: Record<Exclude<WebFilter['key'], 'channel'>, string> = {
  path: 'pathname',
  host: 'host',
  device: 'device',
  country: 'country',
  referrer: 'referring_domain',
  utm: 'utm_source',
  browser: 'browser',
  os: 'os',
};

/** Filtros de la página (AND). '(none)' es la fila "desconocido" de cada tabla. */
export function webFiltersSql(filters: readonly WebFilter[], alias = 'e'): Frag {
  const parts: string[] = [];
  const args: Array<string | number | null> = [];
  for (const f of filters) {
    const col = f.key === 'channel' ? channelSql(alias) : `${alias}.${FILTER_COLUMNS[f.key]}`;
    if (f.value === '(none)') {
      parts.push(`${col} IS NULL`);
    } else {
      parts.push(`${col} = ?`);
      args.push(f.value);
    }
  }
  return { sql: parts.join(' AND '), args };
}

export function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

/** Número reportado por el navegador → válido y acotado (null si no sirve: no cuenta como muestra). */
export function cleanVital(metric: VitalMetric, raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > VITAL_THRESHOLDS[metric].max) return null;
  return n;
}

export interface VitalRow {
  path: string | null;
  LCP?: unknown;
  INP?: unknown;
  CLS?: unknown;
  FCP?: unknown;
}

function summarize(metric: VitalMetric, values: number[]): VitalSummary {
  const sorted = [...values].sort((a, b) => a - b);
  const p75 = percentile(sorted, 75);
  return { metric, p75, samples: sorted.length, rating: p75 === null ? null : vitalRating(metric, p75) };
}

/** p75 por métrica y por página (las N con más muestras) sobre filas ya acotadas. */
export function computeVitals(rows: readonly VitalRow[], truncated: boolean, maxPages = 20): VitalsResult {
  const all: Record<VitalMetric, number[]> = { LCP: [], INP: [], CLS: [], FCP: [] };
  const byPage = new Map<string, { samples: number; values: Record<VitalMetric, number[]> }>();
  for (const r of rows) {
    const path = r.path ?? '(none)';
    let page = byPage.get(path);
    if (!page) {
      page = { samples: 0, values: { LCP: [], INP: [], CLS: [], FCP: [] } };
      byPage.set(path, page);
    }
    let any = false;
    for (const m of VITAL_METRICS) {
      const v = cleanVital(m, r[m]);
      if (v === null) continue;
      all[m].push(v);
      page.values[m].push(v);
      any = true;
    }
    if (any) page.samples++;
  }
  const pages = [...byPage.entries()]
    .filter(([, p]) => p.samples > 0)
    .sort((a, b) => b[1].samples - a[1].samples || a[0].localeCompare(b[0]))
    .slice(0, maxPages)
    .map(([path, p]) => ({ path, samples: p.samples, metrics: VITAL_METRICS.map((m) => summarize(m, p.values[m])) }));
  return {
    metrics: VITAL_METRICS.map((m) => summarize(m, all[m])),
    pages,
    samples: [...byPage.values()].reduce((a, p) => a + p.samples, 0),
    truncated,
  };
}
