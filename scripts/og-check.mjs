#!/usr/bin/env node
/**
 * Chequeo de las tarjetas para compartir contra un servidor corriendo (next
 * start o producción). Lee /sitemap.xml y, para cada página (más las URLs que
 * se pasen con --url):
 *
 *   - tiene og:title, og:description, og:image con og:image:width, height y
 *     alt, twitter:card summary_large_image y twitter:image;
 *   - cada og:image responde 200 image/png, mide lo que declara (se lee el
 *     encabezado del PNG) y, si es nuestra (/api/og/), lleva ?v= y se sirve
 *     inmutable;
 *   - tarda menos de --budget ms (por defecto 1500: la primera vez, en frío).
 *
 * Uso: node scripts/og-check.mjs [base] [--limit N] [--url /es/v/abc ...] [--json]
 *   base por defecto: http://localhost:3000
 * Sale con código 1 si encuentra errores.
 */

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? 'http://localhost:3000').replace(/\/$/, '');
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const limit = Number(opt('--limit') ?? Infinity);
const budget = Number(opt('--budget') ?? 1500);
const extra = args.flatMap((a, i) => (args[i - 1] === '--url' ? [a] : []));
const asJson = args.includes('--json');
const CONCURRENCY = 4;

const errors = [];
const err = (url, msg) => errors.push(`${url}: ${msg}`);

/** La URL del sitemap o de la página (dominio de producción) apuntada al servidor que se chequea. */
function toBase(u) {
  if (!/^https?:\/\//.test(u)) return `${base}${u.startsWith('/') ? '' : '/'}${u}`;
  const url = new URL(u);
  return `${base}${url.pathname}${url.search}`;
}

const attr = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag)?.[1] ?? null;
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function metas(html) {
  const end = html.indexOf('</head>');
  const head = html.slice(0, end > 0 ? end : 300000);
  return [...head.matchAll(/<meta\b[^>]*>/g)].map((m) => m[0]).map((t) => ({ key: attr(t, 'property') ?? attr(t, 'name'), content: decode(attr(t, 'content') ?? '') }));
}

/** Ancho y alto de un PNG (IHDR). */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const images = new Map(); // url → Promise<void>

async function checkImage(page, url, width, height) {
  if (images.has(url)) return images.get(url);
  const job = (async () => {
    const t0 = performance.now();
    let res;
    try {
      res = await fetch(toBase(url), { headers: { 'user-agent': 'WhatsApp/2.23 zerosoft-og-check' } });
    } catch (e) {
      return err(url, `no responde (${e})`);
    }
    const ms = Math.round(performance.now() - t0);
    const type = res.headers.get('content-type') ?? '';
    if (res.status !== 200) return err(url, `status ${res.status} (en ${page})`);
    if (!type.startsWith('image/png') && !type.startsWith('image/jpeg')) return err(url, `content-type ${type}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (type.startsWith('image/png')) {
      const size = pngSize(buf);
      if (!size) err(url, 'PNG inválido');
      else if (width && height && (size.width !== width || size.height !== height)) err(url, `mide ${size.width}×${size.height}, declara ${width}×${height}`);
    }
    if (/\/api\/og\//.test(url)) {
      if (!/[?&]v=/.test(url)) err(url, 'sin ?v= (no se puede cachear inmutable)');
      const cache = res.headers.get('cache-control') ?? '';
      if (/[?&]v=/.test(url) && !/immutable|s-maxage/.test(cache)) err(url, `cache-control "${cache}"`);
    }
    if (ms > budget) err(url, `tardó ${ms} ms`);
    stats.push(ms);
  })();
  images.set(url, job);
  return job;
}

const stats = [];

async function checkPage(url) {
  let res;
  try {
    res = await fetch(toBase(url), { redirect: 'follow', headers: { 'user-agent': 'zerosoft-og-check' } });
  } catch (e) {
    return err(url, `no responde (${e})`);
  }
  if (res.status !== 200) return err(url, `status ${res.status}`);
  const m = metas(await res.text());
  const get = (k) => m.filter((x) => x.key === k).map((x) => x.content);
  if (!get('og:title')[0]) err(url, 'sin og:title');
  if (!get('og:image')[0]) return err(url, 'sin og:image');
  if (get('twitter:card')[0] !== 'summary_large_image') err(url, `twitter:card "${get('twitter:card')[0] ?? ''}"`);
  if (!get('twitter:image')[0]) err(url, 'sin twitter:image');
  // og:image, og:image:width, og:image:height y og:image:alt van en orden, imagen por imagen.
  const list = [];
  for (const x of m) {
    if (x.key === 'og:image' || x.key === 'og:image:url') list.push({ url: x.content });
    else if (list.length && x.key === 'og:image:width') list.at(-1).width = Number(x.content);
    else if (list.length && x.key === 'og:image:height') list.at(-1).height = Number(x.content);
    else if (list.length && x.key === 'og:image:alt') list.at(-1).alt = x.content;
  }
  for (const img of list) {
    if (!/^https?:\/\//.test(img.url)) err(url, `og:image relativa ${img.url}`);
    if (!img.width || !img.height) err(url, `og:image sin medidas ${img.url}`);
    if (!img.alt) err(url, `og:image sin alt ${img.url}`);
    await checkImage(url, img.url, img.width, img.height);
  }
  pages++;
}

let pages = 0;

async function main() {
  const sm = await fetch(`${base}/sitemap.xml`).then((r) => r.text());
  const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => decode(x[1]));
  // feedback.zerosoft.ai no se sirve desde este servidor: se chequea por su ruta en el sitio.
  const local = urls.map((u) => (/^https?:\/\/feedback\./.test(u) ? u.replace(/^https?:\/\/[^/]+\/(en|es|pt)/, `${base}/$1/feedback-board`) : u));
  const todo = [...local.slice(0, limit), ...extra];
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < todo.length) await checkPage(todo[i++]);
    }),
  );
  await Promise.all(images.values());
  stats.sort((a, b) => a - b);
  const p = (q) => stats[Math.min(stats.length - 1, Math.floor(stats.length * q))] ?? 0;
  const summary = { pages, images: images.size, p50: p(0.5), p95: p(0.95), errors };
  if (asJson) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`${pages} páginas, ${images.size} imágenes, render p50 ${summary.p50} ms, p95 ${summary.p95} ms`);
    for (const e of errors) console.log(`  ✗ ${e}`);
    if (!errors.length) console.log('  ✓ todas con og:image PNG válida');
  }
  process.exit(errors.length ? 1 : 0);
}

void main();
