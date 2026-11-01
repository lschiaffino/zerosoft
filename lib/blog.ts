import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { marked } from 'marked';
import { PRODUCT_KEYS, type ProductKey } from '@/lib/products';

/**
 * Blog: posts en markdown en content/blog/<locale>/<slug>.md, con el mismo
 * slug en los tres idiomas. Frontmatter: title, description, date (yyyy-mm-dd),
 * updated (opcional, la última revisión), author, tags.
 *
 * Los links internos del markdown se escriben sin idioma ("/products/crm") y
 * acá se reescriben al del post ("/es/products/crm"): sin el redirect del
 * middleware de por medio, los buscadores siguen el link directo.
 */

const CONTENT_DIR = path.join(process.cwd(), 'content', 'blog');
export const BLOG_LOCALES = ['en', 'es', 'pt'] as const;
type BlogLocale = (typeof BLOG_LOCALES)[number];

/** Autores conocidos. Todos los posts hoy los firma el equipo. */
export const AUTHORS: Record<string, { slug: string; name: string }> = {
  zerosoft: { slug: 'zerosoft', name: 'zerosoft' },
};

export interface PostMeta {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO yyyy-mm-dd
  /** Última revisión (yyyy-mm-dd); igual a date si nunca se revisó. */
  updated: string;
  author: string;
  tags: string[];
  readingTime: number; // minutos
  wordCount: number;
}

export interface Post extends PostMeta {
  html: string;
}

export function readingTimeMinutes(text: string): number {
  return Math.max(1, Math.round(wordCount(text) / 200));
}

function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** "Migración" → "migracion"; "self-hosting" queda igual. */
export function tagSlug(tag: string): string {
  return tag
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const LOCALE_PREFIX = /^\/(en|es|pt)(\/|$)/;
/** Rutas que no llevan idioma (API, archivos, redirects cortos). */
const NO_LOCALE = /^\/(api|_next|r|s|uploads|llms(-full)?\.txt|sitemap\.xml|robots\.txt)(\/|$)/;

/** Pone el idioma del post en los links internos del HTML ("/blog/x" → "/es/blog/x"). */
export function localizeLinks(html: string, locale: string): string {
  return html.replace(/href="(\/[^"]*)"/g, (whole, href: string) => {
    if (href.startsWith('//') || LOCALE_PREFIX.test(href) || NO_LOCALE.test(href)) return whole;
    return `href="/${locale}${href === '/' ? '' : href}"`;
  });
}

function postsDir(locale: string): string {
  return path.join(CONTENT_DIR, locale);
}

function listSlugs(locale: string): string[] {
  const dir = postsDir(locale);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

function isoDay(value: unknown, fallback: string): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return fallback;
}

// En producción los posts no cambian entre requests: se parsean una vez.
const cache = new Map<string, Post | null>();
const useCache = process.env.NODE_ENV === 'production';

function readPost(locale: string, slug: string): Post | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const key = `${locale}/${slug}`;
  if (useCache && cache.has(key)) return cache.get(key) ?? null;
  const file = path.join(postsDir(locale), `${slug}.md`);
  let post: Post | null = null;
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    const { data, content } = matter(raw);
    const html = localizeLinks(marked.parse(content, { async: false }) as string, locale);
    const date = isoDay(data.date, '2026-01-01');
    const words = wordCount(content);
    post = {
      slug,
      title: data.title ?? slug,
      description: data.description ?? '',
      date,
      updated: isoDay(data.updated, date),
      author: data.author ?? 'zerosoft',
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      readingTime: Math.max(1, Math.round(words / 200)),
      wordCount: words,
      html,
    };
  }
  if (useCache) cache.set(key, post);
  return post;
}

/** Todos los posts de un locale, más nuevos primero (a igual fecha, por slug). */
export function getAllPosts(locale: string): PostMeta[] {
  return listSlugs(locale)
    .map((slug) => readPost(locale, slug))
    .filter((p): p is Post => p !== null)
    .map(({ html: _html, ...meta }) => meta)
    .sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : a.date < b.date ? 1 : -1));
}

/**
 * Un post por slug. Si no existe en el locale pedido, cae al inglés.
 * Devuelve null si no existe en ninguno.
 */
export function getPost(locale: string, slug: string): Post | null {
  const order: BlogLocale[] = [locale as BlogLocale, 'en', ...BLOG_LOCALES.filter((l) => l !== locale && l !== 'en')];
  for (const l of order) {
    const post = readPost(l, slug);
    if (post) return post;
  }
  return null;
}

/** El post existe escrito en ese idioma (no por la caída al inglés). */
export function hasPostIn(locale: string, slug: string): boolean {
  return readPost(locale, slug) !== null;
}

/** Idiomas en los que está escrito el post. */
export function postLocales(slug: string): BlogLocale[] {
  return BLOG_LOCALES.filter((l) => hasPostIn(l, slug));
}

/** Slugs conocidos (unión de todos los locales) — para generateStaticParams. */
export function getAllSlugs(): string[] {
  const set = new Set<string>();
  for (const l of BLOG_LOCALES) {
    for (const s of listSlugs(l)) set.add(s);
  }
  return [...set];
}

export interface TagInfo {
  slug: string;
  /** Cómo se escribe en los posts de ese idioma. */
  label: string;
  count: number;
}

/** Tags de un idioma con su cantidad de posts, de más a menos. */
export function getTags(locale: string): TagInfo[] {
  const map = new Map<string, TagInfo>();
  for (const post of getAllPosts(locale)) {
    for (const tag of post.tags) {
      const slug = tagSlug(tag);
      if (!slug) continue;
      const cur = map.get(slug);
      if (cur) cur.count += 1;
      else map.set(slug, { slug, label: tag, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}

export function getPostsByTag(locale: string, slug: string): PostMeta[] {
  return getAllPosts(locale).filter((p) => p.tags.some((t) => tagSlug(t) === slug));
}

/** Un tag con menos posts que esto es una página fina: se lista pero va noindex. */
export const TAG_MIN_POSTS = 2;

/** Idiomas en los que el tag tiene al menos `min` posts (por defecto, los indexables). */
export function tagLocales(slug: string, min = TAG_MIN_POSTS): BlogLocale[] {
  return BLOG_LOCALES.filter((l) => getPostsByTag(l, slug).length >= min);
}

export function getPostsByAuthor(locale: string, author: string): PostMeta[] {
  return getAllPosts(locale).filter((p) => p.author === author);
}

/** La app de la que habla el post: el primer tag que es una app ("crm", "track"). */
export function productOfPost(post: Pick<PostMeta, 'tags'>): ProductKey | null {
  for (const tag of post.tags) {
    const t = tagSlug(tag);
    if ((PRODUCT_KEYS as string[]).includes(t)) return t as ProductKey;
  }
  return null;
}

/**
 * Posts relacionados: los que comparten más tags (la app cuenta doble), a
 * igualdad el más nuevo. Si no alcanzan, los más recientes.
 */
export function relatedPosts(locale: string, slug: string, limit = 3): PostMeta[] {
  const all = getAllPosts(locale);
  const current = all.find((p) => p.slug === slug);
  if (!current) return all.filter((p) => p.slug !== slug).slice(0, limit);
  const tags = new Set(current.tags.map(tagSlug));
  const product = productOfPost(current);
  const scored = all
    .filter((p) => p.slug !== slug)
    .map((p) => {
      let score = 0;
      for (const t of p.tags) if (tags.has(tagSlug(t))) score += 1;
      if (product && productOfPost(p) === product) score += 1;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.p.date < b.p.date ? 1 : a.p.date > b.p.date ? -1 : 0));
  const picked = scored.slice(0, limit).map((x) => x.p);
  if (picked.length < limit) {
    for (const p of all) {
      if (picked.length >= limit) break;
      if (p.slug !== slug && !picked.includes(p)) picked.push(p);
    }
  }
  return picked;
}

/** Fecha del post más nuevo o revisado de un idioma (lastmod del índice y los feeds). */
export function latestPostDate(locale: string): string | null {
  let latest: string | null = null;
  for (const p of getAllPosts(locale)) {
    if (!latest || p.updated > latest) latest = p.updated;
  }
  return latest;
}

/** Posts que hablan de una app o de un competidor (para enlazar desde comparaciones). */
export function postsAbout(locale: string, keys: string[], limit = 4): PostMeta[] {
  const wanted = new Set(keys.map(tagSlug));
  return getAllPosts(locale)
    .filter((p) => p.tags.some((t) => wanted.has(tagSlug(t))))
    .slice(0, limit);
}
