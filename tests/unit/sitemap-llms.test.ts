import { describe, expect, it } from 'vitest';
import { sitemapEntries } from '@/lib/sitemap-entries';
import { llmsFullTxt, llmsTxt } from '@/lib/llms';
import { atomFeed, rssFeed } from '@/lib/blog-feed';
import { BLOG_LOCALES, getAllPosts, getAllSlugs, getPost, getTags, postLocales, relatedPosts, TAG_MIN_POSTS } from '@/lib/blog';
import { compareSlugs, getComparisons } from '@/lib/compare';
import { PRODUCT_CONFIG, PRODUCT_KEYS } from '@/lib/products';
import { TOOLS } from '@/lib/tools/registry';
import { siteOrigin } from '@/lib/seo';
import { STATIC_PAGES } from '@/lib/seo-routes';
import keywords from '@/content/seo-keywords.json';

const origin = siteOrigin();
const entries = sitemapEntries();
const urls = entries.map((e) => e.url);

describe('sitemap.xml', () => {
  it('sin URLs repetidas y todas absolutas', () => {
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of urls) expect(u.startsWith(`${origin}/`)).toBe(true);
  });

  it('cada página fija, app, comparación y herramienta en los tres idiomas', () => {
    for (const l of ['en', 'es', 'pt']) {
      for (const p of Object.values(STATIC_PAGES)) expect(urls).toContain(`${origin}/${l}${p.path}`);
      for (const k of PRODUCT_KEYS) expect(urls).toContain(`${origin}/${l}/products/${k}`);
      for (const s of compareSlugs()) expect(urls).toContain(`${origin}/${l}/compare/${s}`);
      for (const t of TOOLS) expect(urls).toContain(`${origin}/${l}/tools/${t.slug}`);
    }
  });

  it('cada post en los idiomas en que está escrito, con lastmod de su fecha', () => {
    for (const l of BLOG_LOCALES) {
      for (const p of getAllPosts(l)) {
        const e = entries.find((x) => x.url === `${origin}/${l}/blog/${p.slug}`);
        expect(e, `${l}/${p.slug}`).toBeDefined();
        expect((e!.lastModified as Date).toISOString().slice(0, 10)).toBe(p.updated);
        expect(Object.keys(e!.alternates!.languages!).sort()).toEqual([...postLocales(p.slug), 'x-default'].sort());
      }
    }
  });

  it('hreflang con x-default en cada entrada', () => {
    for (const e of entries) {
      const langs = e.alternates?.languages as Record<string, string>;
      expect(langs['x-default'], e.url).toBeTruthy();
      expect(Object.values(langs)).toContain(e.url);
    }
  });

  it('lastmod solo con fechas reales (nunca "ahora")', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const e of entries) {
      if (!e.lastModified) continue;
      const d = (e.lastModified as Date).toISOString();
      expect(d.endsWith('T00:00:00.000Z'), e.url).toBe(true);
      expect(d.slice(0, 10) <= today, e.url).toBe(true);
    }
  });

  it('los tags con un solo post no van (son noindex)', () => {
    for (const l of BLOG_LOCALES) {
      for (const tag of getTags(l)) {
        const has = urls.includes(`${origin}/${l}/blog/tag/${tag.slug}`);
        expect(has, `${l}/${tag.slug}`).toBe(tag.count >= TAG_MIN_POSTS);
      }
    }
  });
});

describe('llms.txt', () => {
  const txt = llmsTxt();
  it('sigue llmstxt.org: H1, resumen en blockquote, secciones H2 con links', () => {
    const lines = txt.split('\n');
    expect(lines[0]).toBe('# zerosoft');
    expect(lines[2].startsWith('> ')).toBe(true);
    expect(txt).toMatch(/^## Apps$/m);
    expect(txt).toMatch(/^## Comparisons$/m);
    expect(txt).toMatch(/^## Pricing$/m);
    expect(txt).toMatch(/^## Optional$/m);
  });
  it('lista cada app y cada comparación con URL estable en inglés', () => {
    for (const k of PRODUCT_KEYS) expect(txt).toContain(`[${PRODUCT_CONFIG[k].name}](${origin}/en/products/${k})`);
    for (const c of getComparisons()) {
      expect(txt).toContain(`${origin}/en/compare/${c.vsSlug}`);
      expect(txt).toContain(`${c.score.percent}% parity`);
    }
    expect(txt).toContain(`${origin}/llms-full.txt`);
  });
  it('sin rayas largas ni marca en mayúscula', () => {
    expect(txt).not.toMatch(/Zerosoft(?!-Signature)/);
  });
  it('la versión completa trae las funciones, lo que falta y las preguntas de cada app', () => {
    const full = llmsFullTxt();
    for (const k of PRODUCT_KEYS) expect(full).toContain(`## ${PRODUCT_CONFIG[k].name}\n`);
    expect(full).toContain('Missing or partial:');
    expect(full).toMatch(/^Q: /m);
    expect(full).not.toMatch(/<\/?(p|a|li|strong)>/);
  });
});

describe('feeds', () => {
  it('RSS y Atom bien formados con los posts más nuevos', () => {
    const rss = rssFeed('es', 'desc');
    const atom = atomFeed('es', 'desc');
    const newest = getAllPosts('es')[0];
    expect(rss).toContain('<rss version="2.0"');
    expect(rss).toContain(`${origin}/es/blog/${newest.slug}</link>`);
    expect(atom).toContain('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="es">');
    expect(atom).toContain(`<id>${origin}/es/blog/${newest.slug}</id>`);
    // Los links del contenido van absolutos.
    expect(rss).not.toMatch(/href="\/(en|es|pt)\//);
  });
});

describe('contenido del blog', () => {
  const routes = new Set([
    ...Object.values(STATIC_PAGES).map((p) => p.path || '/'),
    ...PRODUCT_KEYS.map((k) => `/products/${k}`),
    ...compareSlugs().map((s) => `/compare/${s}`),
    ...TOOLS.map((t) => `/tools/${t.slug}`),
    '/feedback-board',
    '/feedback-board/roadmap',
  ]);

  it.each(BLOG_LOCALES)('%s: frontmatter completo y sin rayas largas en título y descripción', (l) => {
    const problems: string[] = [];
    for (const p of getAllPosts(l)) {
      if (!p.description) problems.push(`${p.slug}: sin description`);
      if (p.tags.length === 0) problems.push(`${p.slug}: sin tags`);
      if (/—/.test(p.title) || /—/.test(p.description)) problems.push(`${p.slug}: raya larga en título o descripción`);
      if (/Zerosoft(?!-Signature)/.test(p.title + p.description)) problems.push(`${p.slug}: marca en mayúscula`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) problems.push(`${p.slug}: fecha ${p.date}`);
    }
    expect(problems).toEqual([]);
  });

  it.each(BLOG_LOCALES)('%s: los links internos de los posts van a páginas que existen', (l) => {
    const slugs = new Set(getAllSlugs());
    const broken: string[] = [];
    for (const meta of getAllPosts(l)) {
      const html = getPost(l, meta.slug)!.html;
      for (const [, href] of html.matchAll(/href="(\/[^"#?]*)/g)) {
        const m = /^\/(en|es|pt)(\/.*)?$/.exec(href);
        if (!m) continue;
        const path = (m[2] ?? '/').replace(/\/$/, '') || '/';
        if (path.startsWith('/blog/')) {
          const rest = path.slice('/blog/'.length);
          if (rest.startsWith('tag/') || rest.startsWith('author/') || slugs.has(rest)) continue;
          broken.push(`${meta.slug} → ${href}`);
        } else if (!routes.has(path) && !path.startsWith('/app') && !path.startsWith('/docs')) {
          broken.push(`${meta.slug} → ${href}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('relacionados: otros posts, sin el mismo y sin repetir', () => {
    for (const slug of getAllSlugs().slice(0, 20)) {
      const rel = relatedPosts('es', slug, 3);
      expect(rel.map((p) => p.slug)).not.toContain(slug);
      expect(new Set(rel.map((p) => p.slug)).size).toBe(rel.length);
    }
  });
});

describe('content/seo-keywords.json', () => {
  it('cada target apunta a una página que existe', () => {
    const slugs = new Set(getAllSlugs());
    const compare = new Set(compareSlugs());
    const broken = keywords.keywords
      .filter((k) => k.target)
      .filter((k) => {
        const t = k.target as string;
        if (t.startsWith('/blog/')) return !slugs.has(t.slice(6));
        if (t.startsWith('/compare/')) return !compare.has(t.slice(9));
        if (t.startsWith('/products/')) return !(PRODUCT_KEYS as string[]).includes(t.slice(10));
        return false;
      })
      .map((k) => `${k.query} → ${k.target}`);
    expect(broken).toEqual([]);
  });
});
