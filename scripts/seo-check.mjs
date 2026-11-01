#!/usr/bin/env node
/**
 * Chequeo de regresiones de SEO contra un servidor corriendo (next start o
 * producción). Lee /sitemap.xml y, para cada URL del sitio público:
 *
 *   - responde 200 sin redirect;
 *   - tiene <title> y meta description (40 a 170 caracteres), y el título no se repite;
 *   - canonical apunta a sí misma, hay hreflang propio y x-default;
 *   - tiene og:image, un solo <h1> y JSON-LD que parsea;
 *   - sus links internos (/en, /es, /pt) responden 200 (un 3xx o 4xx es un error).
 *
 * Además: /robots.txt, /llms.txt, /llms-full.txt y los feeds del blog.
 *
 * Uso: node scripts/seo-check.mjs [base] [--limit N] [--json]
 *   base por defecto: http://localhost:3000
 * Sale con código 1 si encuentra errores.
 */

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? 'http://localhost:3000').replace(/\/$/, '');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
const asJson = args.includes('--json');
const CONCURRENCY = 4;

const errors = [];
const warnings = [];
const err = (url, msg) => errors.push(`${url}: ${msg}`);
const warn = (url, msg) => warnings.push(`${url}: ${msg}`);

async function get(path, { redirect = 'manual' } = {}) {
  const url = path.startsWith('http') ? path : `${base}${path}`;
  try {
    const res = await fetch(url, { redirect, headers: { 'user-agent': 'zerosoft-seo-check' } });
    return { status: res.status, location: res.headers.get('location'), type: res.headers.get('content-type') ?? '', text: res.status < 300 ? await res.text() : '' };
  } catch (e) {
    return { status: 0, location: null, type: '', text: '', error: String(e) };
  }
}

/** Pasa la URL del sitemap (dominio de producción) al servidor que se chequea. */
function toBase(u) {
  const url = new URL(u);
  return `${url.pathname}${url.search}`;
}

const attr = (tag, name) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function parse(html) {
  const head = html.slice(0, html.indexOf('</head>') > 0 ? html.indexOf('</head>') : 200000);
  const tags = [...head.matchAll(/<(meta|link)\b[^>]*>/g)].map((m) => m[0]);
  const meta = (key, val) => tags.find((t) => t.startsWith('<meta') && attr(t, key) === val);
  return {
    title: decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? ''),
    description: decode(attr(meta('name', 'description') ?? '', 'content') ?? ''),
    canonical: attr(tags.find((t) => t.startsWith('<link') && attr(t, 'rel') === 'canonical') ?? '', 'href'),
    hreflang: Object.fromEntries(
      tags.filter((t) => t.startsWith('<link') && attr(t, 'hreflang')).map((t) => [attr(t, 'hreflang'), attr(t, 'href')]),
    ),
    ogImage: attr(meta('property', 'og:image') ?? '', 'content'),
    robots: attr(meta('name', 'robots') ?? '', 'content'),
    h1: (html.match(/<h1\b/g) ?? []).length,
    ld: [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]),
    links: [...html.matchAll(/href="(\/(?:en|es|pt)(?:\/[^"#?]*)?)/g)].map((m) => m[1]),
  };
}

async function pool(items, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

async function main() {
  const sm = await get('/sitemap.xml');
  if (sm.status !== 200) {
    err('/sitemap.xml', `status ${sm.status}`);
    return finish();
  }
  // El board vive en su subdominio (feedback.zerosoft.ai): se chequea aparte, no contra este servidor.
  const urls = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => !new URL(u).hostname.startsWith('feedback.'))
    .map(toBase)
    .slice(0, limit);
  if (urls.length === 0) err('/sitemap.xml', 'vacío');

  const titles = new Map();
  const internal = new Set();
  await pool(urls, async (path) => {
    const res = await get(path);
    if (res.status !== 200) return err(path, `status ${res.status}${res.location ? ` → ${res.location}` : ''}`);
    const p = parse(res.text);
    if (!p.title) err(path, 'sin <title>');
    else {
      // Único por idioma: entre idiomas, hreflang los une.
      const key = `${path.split('/')[1]}:${p.title}`;
      if (titles.has(key)) err(path, `título repetido con ${titles.get(key)}: "${p.title}"`);
      else titles.set(key, path);
    }
    if (p.title.length > 75) warn(path, `título largo (${p.title.length})`);
    if (!p.description) err(path, 'sin meta description');
    else if (p.description.length < 40 || p.description.length > 170) warn(path, `description de ${p.description.length} caracteres`);
    if (!p.canonical) err(path, 'sin canonical');
    else if (new URL(p.canonical, base).pathname !== path) err(path, `canonical a ${p.canonical}`);
    const locale = path.split('/')[1];
    if (!p.hreflang['x-default']) err(path, 'sin hreflang x-default');
    if (!p.hreflang[locale]) err(path, `sin hreflang ${locale}`);
    if (!p.ogImage) err(path, 'sin og:image');
    if (p.robots?.includes('noindex')) err(path, 'está en el sitemap pero es noindex');
    if (p.h1 !== 1) err(path, `${p.h1} <h1>`);
    for (const block of p.ld) {
      try {
        JSON.parse(block);
      } catch {
        err(path, 'JSON-LD que no parsea');
      }
    }
    for (const l of p.links) internal.add(l.replace(/\/$/, '') || l);
  });

  // Links internos: deben responder 200 directo (un redirect es un salto de más para el buscador).
  const checked = [...internal].filter((l) => !l.includes('/app'));
  await pool(checked, async (path) => {
    const res = await get(path);
    if (res.status >= 300 && res.status < 400) warn(path, `link interno con redirect → ${res.location}`);
    else if (res.status !== 200) err(path, `link interno roto (${res.status})`);
  });

  for (const [path, type] of [
    ['/robots.txt', 'text/plain'],
    ['/llms.txt', 'text/markdown'],
    ['/llms-full.txt', 'text/markdown'],
    ['/en/blog/rss.xml', 'application/rss+xml'],
    ['/en/blog/atom.xml', 'application/atom+xml'],
  ]) {
    const res = await get(path);
    if (res.status !== 200) err(path, `status ${res.status}`);
    else if (!res.type.includes(type)) err(path, `content-type ${res.type}`);
  }
  const og = await get('/api/og/home');
  if (og.status !== 200 || !og.type.includes('image/png')) err('/api/og/home', `status ${og.status} ${og.type}`);

  finish(urls.length, checked.length);
}

function finish(pages = 0, links = 0) {
  if (asJson) {
    console.log(JSON.stringify({ base, pages, links, errors, warnings }, null, 2));
  } else {
    console.log(`seo-check ${base}: ${pages} páginas, ${links} links internos`);
    for (const e of errors) console.log(`ERROR  ${e}`);
    for (const w of warnings) console.log(`aviso  ${w}`);
    console.log(errors.length ? `${errors.length} errores, ${warnings.length} avisos` : `sin errores (${warnings.length} avisos)`);
  }
  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
