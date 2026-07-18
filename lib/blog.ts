import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { marked } from 'marked';

const CONTENT_DIR = path.join(process.cwd(), 'content', 'blog');
const LOCALES = ['en', 'es', 'pt'] as const;
type BlogLocale = (typeof LOCALES)[number];

export interface PostMeta {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO yyyy-mm-dd
  author: string;
  tags: string[];
  readingTime: number; // minutos
}

export interface Post extends PostMeta {
  html: string;
}

function readingTimeMinutes(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
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
    .map((f) => f.replace(/\.md$/, ''));
}

function readPost(locale: string, slug: string): Post | null {
  const file = path.join(postsDir(locale), `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  const { data, content } = matter(raw);
  const html = marked.parse(content, { async: false }) as string;
  return {
    slug,
    title: data.title ?? slug,
    description: data.description ?? '',
    date: data.date ? String(data.date) : '2026-01-01',
    author: data.author ?? 'Zerosoftware',
    tags: Array.isArray(data.tags) ? data.tags : [],
    readingTime: readingTimeMinutes(content),
    html,
  };
}

/** Todos los posts de un locale, más nuevos primero. */
export function getAllPosts(locale: string): PostMeta[] {
  const slugs = listSlugs(locale);
  const posts = slugs
    .map((slug) => readPost(locale, slug))
    .filter((p): p is Post => p !== null)
    .map(({ html: _html, ...meta }) => meta);
  return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * Un post por slug. Si no existe en el locale pedido, cae al inglés.
 * Devuelve null si no existe en ninguno.
 */
export function getPost(locale: string, slug: string): Post | null {
  const order: BlogLocale[] = [
    locale as BlogLocale,
    'en',
    ...LOCALES.filter((l) => l !== locale && l !== 'en'),
  ];
  for (const l of order) {
    const post = readPost(l, slug);
    if (post) return post;
  }
  return null;
}

/** Slugs conocidos (unión de todos los locales) — para generateStaticParams. */
export function getAllSlugs(): string[] {
  const set = new Set<string>();
  for (const l of LOCALES) {
    for (const s of listSlugs(l)) set.add(s);
  }
  return [...set];
}
