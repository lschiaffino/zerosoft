import { safeFetch, UnsafeUrlError } from '../safe-fetch';

/**
 * Website grader: baja la página (con safeFetch, protegido contra SSRF, y
 * siguiendo redirects a mano para revalidar cada salto), y puntúa señales de
 * seguridad, performance, SEO, mobile y accesibilidad sobre 100. El análisis
 * del HTML es puro (regex, sin DOM) para poder testearlo con fixtures.
 */

export type GradeCategory = 'security' | 'performance' | 'seo' | 'mobile' | 'accessibility';
export const GRADE_CATEGORIES: readonly GradeCategory[] = ['security', 'performance', 'seo', 'mobile', 'accessibility'];

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface GradeCheck {
  id: string;
  category: GradeCategory;
  status: CheckStatus;
  weight: number;
  /** Dato medido para mostrar (ej. "640 ms", "12/15"). */
  value?: string;
}

export interface GradeResult {
  url: string;
  finalUrl: string;
  score: number;
  categories: Array<{ id: GradeCategory; score: number }>;
  checks: GradeCheck[];
  /** Performance de Lighthouse (0–100) si hay PAGESPEED_API_KEY. */
  pagespeed: number | null;
}

export interface PageSnapshot {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  bytes: number;
  ms: number;
  headers: Headers;
  robotsTxt: boolean | null;
  sitemap: boolean | null;
}

// ---------- Parseo ----------

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

function tags(html: string, name: string): string[] {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];
}

function metaContent(html: string, key: string): string | null {
  for (const tag of tags(html, 'meta')) {
    const n = (attr(tag, 'name') ?? attr(tag, 'property') ?? '').toLowerCase();
    if (n === key) return (attr(tag, 'content') ?? '').trim();
  }
  return null;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function linkRel(html: string, rel: string): string | null {
  for (const tag of tags(html, 'link')) {
    const r = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    if (r.includes(rel)) return attr(tag, 'href') ?? '';
  }
  return null;
}

function headSection(html: string): string {
  const m = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  return m ? m[1] : html.slice(0, 20000);
}

// ---------- Puntaje ----------

function check(
  id: string,
  category: GradeCategory,
  weight: number,
  status: CheckStatus,
  value?: string,
): GradeCheck {
  return { id, category, weight, status, value };
}

const ratio = (s: CheckStatus) => (s === 'pass' ? 1 : s === 'warn' ? 0.5 : 0);

export function analyzePage(p: PageSnapshot): Omit<GradeResult, 'pagespeed'> {
  const html = p.html;
  const head = headSection(html);
  const h = p.headers;
  const checks: GradeCheck[] = [];
  const final = new URL(p.finalUrl);

  // Seguridad (20)
  checks.push(check('https', 'security', 12, final.protocol === 'https:' ? 'pass' : 'fail'));
  const hsts = h.get('strict-transport-security');
  checks.push(check('hsts', 'security', 4, hsts ? 'pass' : 'fail'));
  const secHeaders = ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy'].filter((k) =>
    h.has(k),
  ).length;
  checks.push(check('securityHeaders', 'security', 4, secHeaders >= 2 ? 'pass' : secHeaders === 1 ? 'warn' : 'fail', `${secHeaders}/4`));

  // Performance (25)
  checks.push(check('responseTime', 'performance', 8, p.ms < 800 ? 'pass' : p.ms < 2000 ? 'warn' : 'fail', `${Math.round(p.ms)} ms`));
  const kb = p.bytes / 1024;
  checks.push(check('pageWeight', 'performance', 5, kb < 150 ? 'pass' : kb < 600 ? 'warn' : 'fail', `${Math.round(kb)} KB`));
  const enc = (h.get('content-encoding') ?? '').toLowerCase();
  checks.push(check('compression', 'performance', 6, /br|gzip|zstd|deflate/.test(enc) ? 'pass' : 'fail', enc || undefined));
  const cache = h.get('cache-control') ?? '';
  const hasCache = Boolean(h.get('etag') || h.get('last-modified') || /max-age=\d+|s-maxage/.test(cache));
  checks.push(check('caching', 'performance', 3, hasCache ? 'pass' : 'fail', cache || undefined));
  const blocking = tags(head, 'script').filter((t) => attr(t, 'src') !== null && !/\b(async|defer)\b/i.test(t) && !/type\s*=\s*["']?module/i.test(t)).length;
  checks.push(check('renderBlocking', 'performance', 3, blocking === 0 ? 'pass' : blocking <= 2 ? 'warn' : 'fail', String(blocking)));

  // SEO (30)
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';
  checks.push(
    check('title', 'seo', 6, !title ? 'fail' : title.length >= 10 && title.length <= 70 ? 'pass' : 'warn', title ? `${title.length}` : undefined),
  );
  const desc = metaContent(html, 'description') ?? '';
  checks.push(
    check('metaDescription', 'seo', 6, !desc ? 'fail' : desc.length >= 50 && desc.length <= 170 ? 'pass' : 'warn', desc ? `${desc.length}` : undefined),
  );
  const h1s = (html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) ?? []).filter((x) => stripTags(x));
  checks.push(check('h1', 'seo', 4, h1s.length === 1 ? 'pass' : h1s.length > 1 ? 'warn' : 'fail', String(h1s.length)));
  checks.push(check('canonical', 'seo', 3, linkRel(html, 'canonical') ? 'pass' : 'fail'));
  const og = ['og:title', 'og:description', 'og:image'].filter((k) => metaContent(html, k)).length;
  checks.push(check('openGraph', 'seo', 4, og === 3 ? 'pass' : og > 0 ? 'warn' : 'fail', `${og}/3`));
  const robotsMeta = (metaContent(html, 'robots') ?? '').toLowerCase();
  const xRobots = (h.get('x-robots-tag') ?? '').toLowerCase();
  checks.push(check('indexable', 'seo', 3, /noindex/.test(robotsMeta + xRobots) ? 'fail' : 'pass'));
  checks.push(check('robotsTxt', 'seo', 2, p.robotsTxt ? 'pass' : 'fail'));
  checks.push(check('sitemap', 'seo', 2, p.sitemap ? 'pass' : 'fail'));

  // Mobile (10)
  const viewport = metaContent(html, 'viewport') ?? '';
  checks.push(
    check('viewport', 'mobile', 7, !viewport ? 'fail' : /width\s*=\s*device-width/i.test(viewport) ? 'pass' : 'warn'),
  );
  const icon = linkRel(html, 'icon') ?? linkRel(html, 'apple-touch-icon') ?? linkRel(html, 'shortcut');
  checks.push(check('icons', 'mobile', 3, icon !== null ? 'pass' : 'fail'));

  // Accesibilidad (15)
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? '';
  checks.push(check('lang', 'accessibility', 4, attr(htmlTag, 'lang') ? 'pass' : 'fail'));
  const imgs = tags(html, 'img');
  const withAlt = imgs.filter((t) => attr(t, 'alt') !== null).length;
  const altPct = imgs.length ? withAlt / imgs.length : 1;
  checks.push(
    check('imageAlt', 'accessibility', 5, altPct >= 0.95 ? 'pass' : altPct >= 0.7 ? 'warn' : 'fail', `${withAlt}/${imgs.length}`),
  );
  const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? [];
  const emptyLinks = anchors.filter((a) => {
    const open = a.match(/<a\b[^>]*>/i)?.[0] ?? '';
    if (attr(open, 'aria-label') || attr(open, 'title')) return false;
    if (/<img\b[^>]*\balt\s*=\s*["'][^"']+["']/i.test(a)) return false;
    return !stripTags(a);
  }).length;
  checks.push(check('linkText', 'accessibility', 3, emptyLinks === 0 ? 'pass' : emptyLinks <= 2 ? 'warn' : 'fail', String(emptyLinks)));
  const inputs = tags(html, 'input').filter((t) => !/type\s*=\s*["']?(hidden|submit|button|image|reset)/i.test(t));
  const labelFor = new Set(tags(html, 'label').map((t) => attr(t, 'for')).filter(Boolean) as string[]);
  const unlabeled = inputs.filter((t) => {
    if (attr(t, 'aria-label') || attr(t, 'aria-labelledby') || attr(t, 'title')) return false;
    const id = attr(t, 'id');
    return !(id && labelFor.has(id));
  }).length;
  checks.push(
    check('formLabels', 'accessibility', 3, unlabeled === 0 ? 'pass' : unlabeled <= 1 ? 'warn' : 'fail', `${inputs.length - unlabeled}/${inputs.length}`),
  );

  const categories = GRADE_CATEGORIES.map((id) => {
    const cs = checks.filter((c) => c.category === id);
    const total = cs.reduce((a, c) => a + c.weight, 0);
    const earned = cs.reduce((a, c) => a + c.weight * ratio(c.status), 0);
    return { id, score: total ? Math.round((earned / total) * 100) : 0 };
  });
  const score = Math.round(checks.reduce((a, c) => a + c.weight * ratio(c.status), 0));
  return { url: p.url, finalUrl: p.finalUrl, score, categories, checks };
}

// ---------- Fetch ----------

export type Fetcher = (url: string, init?: RequestInit, timeoutMs?: number) => Promise<Response>;

export class GradeError extends Error {
  constructor(public code: 'invalid_url' | 'private_host' | 'https_required' | 'unreachable' | 'timeout' | 'not_html' | 'http_error') {
    super(code);
  }
}

const MAX_BYTES = 3 * 1024 * 1024;
const UA = 'Mozilla/5.0 (compatible; ZerosoftWebsiteGrader/1.0; +https://zerosoft.ai/tools/website-grader)';

export function normalizeUrl(raw: string): string {
  const v = raw.trim();
  if (!v || v.length > 2048) throw new GradeError('invalid_url');
  const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withProto);
    if (!u.hostname.includes('.')) throw new Error('no tld');
    return u.toString();
  } catch {
    throw new GradeError('invalid_url');
  }
}

async function readCapped(res: Response): Promise<{ text: string; bytes: number }> {
  if (!res.body) {
    const text = await res.text();
    return { text, bytes: new TextEncoder().encode(text).length };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(Math.min(bytes, MAX_BYTES));
  let off = 0;
  for (const c of chunks) {
    buf.set(c.subarray(0, Math.min(c.length, buf.length - off)), off);
    off += c.length;
    if (off >= buf.length) break;
  }
  return { text: new TextDecoder().decode(buf), bytes };
}

function mapError(err: unknown): GradeError {
  if (err instanceof GradeError) return err;
  if (err instanceof UnsafeUrlError) {
    if (err.message === 'https_required') return new GradeError('https_required');
    return new GradeError(err.message === 'invalid_url' || err.message === 'unresolvable_host' ? 'invalid_url' : 'private_host');
  }
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return new GradeError('timeout');
  return new GradeError('unreachable');
}

/** GET siguiendo hasta 5 redirects, cada salto revalidado por el fetcher. */
async function fetchFollow(fetcher: Fetcher, url: string, accept: string, timeoutMs: number) {
  let current = url;
  for (let i = 0; i < 6; i++) {
    const res = await fetcher(current, { headers: { 'user-agent': UA, accept, 'accept-encoding': 'gzip, deflate, br' } }, timeoutMs);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location') as string, current).toString();
      await res.body?.cancel().catch(() => {});
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new GradeError('unreachable');
}

async function exists(fetcher: Fetcher, url: string, match: RegExp): Promise<boolean> {
  try {
    const { res } = await fetchFollow(fetcher, url, 'text/plain,application/xml,*/*', 5000);
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return false;
    }
    const { text } = await readCapped(res);
    return match.test(text.slice(0, 5000));
  } catch {
    return false;
  }
}

async function pagespeedScore(url: string): Promise<number | null> {
  const key = process.env.PAGESPEED_API_KEY?.trim();
  if (!key) return null;
  try {
    const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    api.searchParams.set('url', url);
    api.searchParams.set('key', key);
    api.searchParams.set('strategy', 'mobile');
    api.searchParams.set('category', 'performance');
    const res = await fetch(api, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { lighthouseResult?: { categories?: { performance?: { score?: number } } } };
    const s = json.lighthouseResult?.categories?.performance?.score;
    return typeof s === 'number' ? Math.round(s * 100) : null;
  } catch {
    return null;
  }
}

export async function gradeWebsite(rawUrl: string, fetcher: Fetcher = safeFetch): Promise<GradeResult> {
  const url = normalizeUrl(rawUrl);
  let snapshot: PageSnapshot;
  try {
    const started = performance.now();
    const { res, finalUrl } = await fetchFollow(fetcher, url, 'text/html,application/xhtml+xml', 10_000);
    const ms = performance.now() - started;
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new GradeError('http_error');
    }
    const type = res.headers.get('content-type') ?? '';
    if (type && !/html/i.test(type)) {
      await res.body?.cancel().catch(() => {});
      throw new GradeError('not_html');
    }
    const { text, bytes } = await readCapped(res);
    const origin = new URL(finalUrl).origin;
    const [robotsTxt, sitemapDirect] = await Promise.all([
      exists(fetcher, `${origin}/robots.txt`, /user-agent|sitemap|disallow|allow/i),
      exists(fetcher, `${origin}/sitemap.xml`, /<(urlset|sitemapindex)\b/i),
    ]);
    let sitemap = sitemapDirect;
    if (!sitemap && robotsTxt) {
      // El sitemap puede estar declarado en robots.txt con otra ruta.
      sitemap = await exists(fetcher, `${origin}/robots.txt`, /^\s*sitemap\s*:/im);
    }
    snapshot = { url, finalUrl, status: res.status, html: text, bytes, ms, headers: res.headers, robotsTxt, sitemap };
  } catch (err) {
    throw mapError(err);
  }
  const [result, pagespeed] = [analyzePage(snapshot), await pagespeedScore(snapshot.finalUrl)];
  return { ...result, pagespeed };
}
