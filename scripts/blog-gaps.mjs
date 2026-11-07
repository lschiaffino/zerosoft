#!/usr/bin/env node
/**
 * Qué escribir o revisar hoy en el blog. Lee el repo (sin servidor):
 *
 *   1. Búsquedas de content/seo-keywords.json sin página (`target: null`), por prioridad.
 *   2. Targets que apuntan a una página que no existe.
 *   3. Apps sin ningún post (por tag de la app).
 *   4. Posts que no están en los tres idiomas.
 *   5. Posts de una app cuya tabla de paridad se revisó después del post
 *      (lo que dice el post de "qué falta" puede estar viejo).
 *
 * Uso: node scripts/blog-gaps.mjs [--json]
 * La rutina diaria (docs/blog-routine.md) toma el primer ítem de la lista.
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LOCALES = ['en', 'es', 'pt'];
const asJson = process.argv.includes('--json');

const slugify = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Mismo slug que lib/compare.ts (competitorSlug). */
const competitorSlug = (name) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*\+\s*$/, ' plus')
    .replace(/\+/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Paridad: competidor y fecha de revisión de cada app.
const parityDir = path.join(root, 'content', 'feature-parity');
const parity = {};
for (const f of fs.readdirSync(parityDir)) {
  if (!f.endsWith('.ts') || f === 'index.ts' || f === 'types.ts') continue;
  const src = fs.readFileSync(path.join(parityDir, f), 'utf8');
  const competitor = /competitor:\s*'([^']+)'/.exec(src)?.[1];
  const lastReviewed = /lastReviewed:\s*'([^']+)'/.exec(src)?.[1];
  if (competitor) parity[f.replace(/\.ts$/, '')] = { competitor, lastReviewed };
}
const products = Object.keys(parity);

// Posts.
const posts = {};
for (const l of LOCALES) {
  const dir = path.join(root, 'content', 'blog', l);
  posts[l] = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { data } = matter(fs.readFileSync(path.join(dir, f), 'utf8'));
      const date = data.date instanceof Date ? data.date.toISOString().slice(0, 10) : String(data.date ?? '');
      const updated = data.updated instanceof Date ? data.updated.toISOString().slice(0, 10) : String(data.updated ?? date);
      return { slug: f.replace(/\.md$/, ''), title: data.title, date, updated, tags: (data.tags ?? []).map(slugify) };
    });
}
const allSlugs = new Set(LOCALES.flatMap((l) => posts[l].map((p) => p.slug)));

// Rutas que existen (las de compare salen de la paridad).
const compareSlugs = new Set(products.flatMap((k) => [`zerosoft-vs-${competitorSlug(parity[k].competitor)}`, `${competitorSlug(parity[k].competitor)}-alternative`]));
function exists(target) {
  if (target.startsWith('/blog/')) return allSlugs.has(target.slice(6));
  if (target.startsWith('/compare/')) return compareSlugs.has(target.slice(9));
  if (target.startsWith('/products/')) return products.includes(target.slice(10));
  return true;
}

const { keywords } = JSON.parse(fs.readFileSync(path.join(root, 'content', 'seo-keywords.json'), 'utf8'));

const report = {
  keywordGaps: keywords.filter((k) => !k.target).sort((a, b) => a.priority - b.priority),
  brokenTargets: keywords.filter((k) => k.target && !exists(k.target)),
  productsWithoutPosts: products.filter((k) => !posts.es.some((p) => p.tags.includes(k))),
  missingLocales: [...allSlugs]
    .map((slug) => ({ slug, missing: LOCALES.filter((l) => !posts[l].some((p) => p.slug === slug)) }))
    .filter((x) => x.missing.length > 0),
  staleAgainstParity: posts.es
    .map((p) => {
      const product = p.tags.find((t) => products.includes(t));
      if (!product) return null;
      const reviewed = parity[product].lastReviewed;
      const talksGaps = p.tags.some((t) => ['migracion', 'comparacion', 'comparativa'].includes(t));
      return talksGaps && reviewed > p.updated ? { slug: p.slug, product, postUpdated: p.updated, parityReviewed: reviewed } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.postUpdated < b.postUpdated ? -1 : 1)),
};

// La tarea de hoy: un post nuevo para la búsqueda más prioritaria sin página;
// si no hay, refrescar el post más viejo contra su tabla de paridad.
report.today = report.brokenTargets[0]
  ? { action: 'fix-target', item: report.brokenTargets[0] }
  : report.keywordGaps[0]
    ? { action: 'write', item: report.keywordGaps[0] }
    : report.productsWithoutPosts[0]
      ? { action: 'write-product-guide', item: report.productsWithoutPosts[0] }
      : report.staleAgainstParity[0]
        ? { action: 'refresh', item: report.staleAgainstParity[0] }
        : { action: 'none' };

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Hoy: ${report.today.action} ${JSON.stringify(report.today.item ?? '')}`);
  console.log(`\nBúsquedas sin página (${report.keywordGaps.length}):`);
  for (const k of report.keywordGaps) console.log(`  p${k.priority} [${k.locale}] ${k.query} (${k.product ?? 'suite'})`);
  if (report.brokenTargets.length) {
    console.log(`\nTargets rotos (${report.brokenTargets.length}):`);
    for (const k of report.brokenTargets) console.log(`  ${k.query} → ${k.target}`);
  }
  console.log(`\nApps sin posts (${report.productsWithoutPosts.length}): ${report.productsWithoutPosts.join(', ')}`);
  console.log(`\nPosts sin los tres idiomas (${report.missingLocales.length}):`);
  for (const m of report.missingLocales) console.log(`  ${m.slug}: falta ${m.missing.join(', ')}`);
  console.log(`\nPosts para revisar contra la paridad (${report.staleAgainstParity.length}):`);
  for (const s of report.staleAgainstParity.slice(0, 10)) console.log(`  ${s.slug} (${s.product}): post ${s.postUpdated}, paridad ${s.parityReviewed}`);
}
