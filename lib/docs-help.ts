import { getDb, type DocsPageRow } from './db';
import { parseBlocks } from './docs';
import { inlineHtmlToText } from './docs-markdown';
import { rankKnowledge, searchTokens } from './knowledge-search';
import type { DocsBlock } from './docs-types';

/**
 * Centro de ayuda público de un workspace: /h/<handle> y /h/<handle>/<slug>.
 * - Solo páginas con published = 1 y archived = 0 del workspace dueño del
 *   handle (users.handle del owner, el mismo de /book y /@handle).
 * - Colecciones = páginas publicadas cuyo padre no está publicado (o no
 *   tienen padre); sus artículos = descendientes publicados, en orden.
 */

export interface HelpWorkspace {
  id: string;
  handle: string;
  name: string;
  accent: string | null;
}

export interface HelpArticleSummary {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  excerpt: string;
  updated_at: string;
}

export interface HelpCollection extends HelpArticleSummary {
  articles: HelpArticleSummary[];
}

export interface HelpArticle extends HelpArticleSummary {
  content: DocsBlock[];
  collection: HelpArticleSummary | null;
  /**
   * Hijas publicadas directas (con excerpt) y sus descendientes: una página
   * con hijas es la portada de su colección y las lista como estaciones.
   */
  children: HelpCollection[];
  prev: HelpArticleSummary | null;
  next: HelpArticleSummary | null;
}

type PublishedRow = Pick<DocsPageRow, 'id' | 'parent_id' | 'title' | 'icon' | 'content' | 'slug' | 'updated_at'>;
/** Fila del árbol sin content: alcanza para ubicar un artículo y su anterior/siguiente. */
type PublishedTreeRow = Omit<PublishedRow, 'content'> & { content?: string };

const HEX = /^#[0-9a-f]{6}$/i;

export async function getHelpWorkspace(handle: string): Promise<HelpWorkspace | null> {
  const user = (await getDb()
    .prepare('SELECT id, handle, name, email FROM users WHERE handle = ?')
    .get(handle.toLowerCase())) as { id: string; handle: string; name: string | null; email: string } | undefined;
  if (!user) return null;
  const team = (await getDb()
    .prepare('SELECT name FROM teams WHERE owner_id = ? ORDER BY created_at ASC LIMIT 1')
    .get(user.id)) as { name: string } | undefined;
  // Acento: el color del widget de Chat con ayuda activa (o el primero).
  const widget = (await getDb()
    .prepare('SELECT color FROM chat_widgets WHERE user_id = ? ORDER BY help_enabled DESC, created_at ASC LIMIT 1')
    .get(user.id)) as { color: string } | undefined;
  const accent = widget && HEX.test(widget.color) && widget.color.toLowerCase() !== '#000000' ? widget.color : null;
  return {
    id: user.id,
    handle: user.handle,
    name: team?.name || user.name || user.handle,
    accent,
  };
}

async function publishedRows(ownerId: string): Promise<PublishedRow[]> {
  return (await getDb()
    .prepare(
      `SELECT id, parent_id, title, icon, content, slug, updated_at FROM docs_pages
       WHERE user_id = ? AND published = 1 AND archived = 0 AND slug IS NOT NULL
       ORDER BY (position IS NULL) ASC, position ASC, created_at ASC`,
    )
    .all(ownerId)) as PublishedRow[];
}

async function publishedTreeRows(ownerId: string): Promise<PublishedTreeRow[]> {
  return (await getDb()
    .prepare(
      `SELECT id, parent_id, title, icon, slug, updated_at FROM docs_pages
       WHERE user_id = ? AND published = 1 AND archived = 0 AND slug IS NOT NULL
       ORDER BY (position IS NULL) ASC, position ASC, created_at ASC`,
    )
    .all(ownerId)) as PublishedTreeRow[];
}

/** Texto plano de una página (sin tags ni entidades), para excerpts y búsqueda. */
export function pagePlainText(content: string, maxChars = 12_000): string {
  const out: string[] = [];
  let len = 0;
  for (const b of parseBlocks(content)) {
    if (len > maxChars) break;
    const text = b.type === 'table' || b.type === 'database'
      ? (b.rows ?? []).map((r) => r.join(' ')).join(' ')
      : inlineHtmlToText(b.content ?? '');
    if (!text.trim()) continue;
    out.push(text);
    len += text.length + 1;
  }
  return out.join(' ').replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

/** Resumen corto: el texto corrido del principio (sin headings ni código), cortado en una palabra. */
export function pageExcerpt(content: string, max = 160): string {
  let text = '';
  for (const b of parseBlocks(content)) {
    if (!['paragraph', 'quote', 'bulleted_list_item', 'numbered_list_item', 'todo'].includes(b.type)) {
      if (text && b.type === 'heading') break;
      continue;
    }
    const piece = inlineHtmlToText(b.content ?? '').replace(/\s+/g, ' ').trim();
    if (!piece) continue;
    text = text ? `${text} ${piece}` : piece;
    if (text.length >= max) break;
  }
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

function summary(row: PublishedTreeRow): HelpArticleSummary {
  return {
    id: row.id,
    slug: row.slug as string,
    title: row.title,
    icon: row.icon,
    // Sin content (árbol liviano) no hay excerpt: no se parsea cada página.
    excerpt: row.content != null ? pageExcerpt(row.content) : '',
    updated_at: row.updated_at,
  };
}

/** Árbol de colecciones (solo páginas publicadas). */
export function buildHelpCollections(rows: PublishedTreeRow[]): HelpCollection[] {
  const ids = new Set(rows.map((r) => r.id));
  const children = new Map<string, PublishedTreeRow[]>();
  for (const r of rows) {
    if (r.parent_id && ids.has(r.parent_id)) {
      const list = children.get(r.parent_id) ?? [];
      list.push(r);
      children.set(r.parent_id, list);
    }
  }
  const descendants = (id: string, seen = new Set<string>()): PublishedTreeRow[] => {
    const out: PublishedTreeRow[] = [];
    for (const c of children.get(id) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c, ...descendants(c.id, seen));
    }
    return out;
  };
  return rows
    .filter((r) => !r.parent_id || !ids.has(r.parent_id))
    .map((root) => ({ ...summary(root), articles: descendants(root.id).map(summary) }));
}

/**
 * Completa el excerpt de estos resúmenes leyendo el content solo de ellos (el
 * árbol viene sin content: no se lee ni parsea cada página publicada).
 */
export async function withHelpExcerpts<T extends HelpArticleSummary>(ownerId: string, items: T[]): Promise<T[]> {
  if (items.length === 0) return items;
  const rows = (await getDb()
    .prepare(
      `SELECT id, content FROM docs_pages WHERE user_id = ? AND id IN (${items.map(() => '?').join(', ')})`,
    )
    .all(ownerId, ...items.map((i) => i.id))) as Array<{ id: string; content: string }>;
  const byId = new Map(rows.map((r) => [r.id, r.content]));
  return items.map((i) => {
    const content = byId.get(i.id);
    return content != null ? { ...i, excerpt: pageExcerpt(content) } : i;
  });
}

/** Colecciones con su excerpt; los artículos van sin excerpt (la home muestra solo el título). */
export async function listHelpCollections(ownerId: string): Promise<HelpCollection[]> {
  return withHelpExcerpts(ownerId, buildHelpCollections(await publishedTreeRows(ownerId)));
}

/** Artículo publicado por slug, con su colección y anterior/siguiente. */
export async function getHelpArticle(ownerId: string, slug: string): Promise<HelpArticle | null> {
  // El árbol va sin content (antes se leían y parseaban todas las páginas
  // publicadas); el content se lee solo para el artículo pedido.
  const rows = await publishedTreeRows(ownerId);
  const treeRow = rows.find((r) => r.slug === slug);
  if (!treeRow) return null;
  const content = (await getDb()
    .prepare('SELECT content FROM docs_pages WHERE id = ? AND user_id = ?')
    .get(treeRow.id, ownerId)) as { content: string } | undefined;
  if (!content) return null;
  const row: PublishedRow = { ...treeRow, content: content.content };
  const collections = buildHelpCollections(rows);
  // Orden de lectura: colección y sus artículos, una colección tras otra.
  const order: Array<{ item: HelpArticleSummary; collection: HelpArticleSummary }> = [];
  for (const c of collections) {
    const { articles, ...head } = c;
    order.push({ item: head, collection: head });
    for (const a of articles) order.push({ item: a, collection: head });
  }
  const idx = order.findIndex((o) => o.item.id === row.id);
  const collection = idx >= 0 && order[idx].collection.id !== row.id ? order[idx].collection : null;
  // Hijas directas con sus propias descendientes (el mismo armado que las colecciones).
  // Sin la página misma, sus hijas quedan como raíces del árbol.
  const childIds = new Set(rows.filter((r) => r.parent_id === row.id).map((r) => r.id));
  const subtree = buildHelpCollections(rows.filter((r) => r.id !== row.id)).filter((c) => childIds.has(c.id));
  return {
    ...summary(row),
    content: parseBlocks(row.content),
    collection,
    children: await withHelpExcerpts(ownerId, subtree),
    prev: idx > 0 ? order[idx - 1].item : null,
    next: idx >= 0 && idx < order.length - 1 ? order[idx + 1].item : null,
  };
}

export interface HelpSearchResult extends HelpArticleSummary {
  score: number;
  /** Colección del artículo (null si el resultado es una colección). */
  collection: Pick<HelpArticleSummary, 'slug' | 'title'> | null;
  /** Artículos de la colección cuando el resultado es una colección. */
  articleCount: number;
}

/**
 * Suma a la consulta las palabras del corpus que comparten raíz con las
 * buscadas ("reembolso" ↔ "reembolsos", "factura" ↔ "facturación"): BM25
 * compara tokens exactos y un visitante no escribe igual que el artículo.
 */
export function expandQuery(query: string, corpus: string[]): string {
  const qTokens = [...new Set(searchTokens(query))];
  if (qTokens.length === 0) return query;
  const vocab = new Set<string>();
  for (const text of corpus) for (const tok of searchTokens(text)) vocab.add(tok);
  const extra = new Set<string>();
  for (const q of qTokens) {
    if (q.length < 4) continue;
    const stem = q.slice(0, Math.max(4, q.length - 2));
    for (const v of vocab) {
      if (v !== q && v.length >= 4 && (v.startsWith(stem) || q.startsWith(v.slice(0, Math.max(4, v.length - 2))))) extra.add(v);
    }
  }
  return extra.size ? `${query} ${[...extra].join(' ')}` : query;
}

/** Búsqueda BM25 (lib/knowledge-search.ts) sobre las páginas publicadas. */
export async function searchHelpArticles(ownerId: string, query: string, k = 5): Promise<HelpSearchResult[]> {
  const rows = await publishedRows(ownerId);
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Cada artículo sabe a qué colección pertenece (para la miga del resultado).
  const collectionOf = new Map<string, HelpArticleSummary>();
  const countOf = new Map<string, number>();
  for (const c of buildHelpCollections(rows)) {
    countOf.set(c.id, c.articles.length);
    for (const a of c.articles) collectionOf.set(a.id, c);
  }
  const docs = rows.map((r) => ({ kind: 'doc' as const, title: r.title, text: pagePlainText(r.content), source: r.id }));
  const ranked = rankKnowledge(docs, expandQuery(query, docs.map((d) => `${d.title} ${d.text}`)), k * 4);
  const out: HelpSearchResult[] = [];
  const seen = new Set<string>();
  for (const c of ranked) {
    if (!c.source || seen.has(c.source)) continue;
    seen.add(c.source);
    const row = byId.get(c.source);
    if (!row) continue;
    const coll = collectionOf.get(row.id);
    out.push({
      ...summary(row),
      score: c.score,
      collection: coll ? { slug: coll.slug, title: coll.title } : null,
      articleCount: coll ? 0 : countOf.get(row.id) ?? 0,
    });
    if (out.length >= k) break;
  }
  return out;
}

/**
 * Feedback "¿Te sirvió?" (público). Solo cuenta para páginas publicadas. Con
 * `voter` (id anónimo del navegador) hay un voto por visitante y página: votar
 * de nuevo cambia el voto en vez de sumar otro.
 */
export async function recordHelpFeedback(pageId: string, helpful: boolean, voter?: string | null): Promise<boolean> {
  const page = (await getDb()
    .prepare('SELECT id, user_id FROM docs_pages WHERE id = ? AND published = 1 AND archived = 0')
    .get(pageId)) as { id: string; user_id: string } | undefined;
  if (!page) return false;
  await getDb()
    .prepare(
      `INSERT INTO docs_feedback (id, page_id, user_id, helpful, voter) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (page_id, voter) WHERE voter IS NOT NULL DO UPDATE SET helpful = excluded.helpful`,
    )
    .run(crypto.randomUUID(), page.id, page.user_id, helpful ? 1 : 0, voter || null);
  return true;
}

export async function getHelpFeedbackStats(ownerId: string, pageId: string): Promise<{ yes: number; no: number }> {
  const row = (await getDb()
    .prepare(
      `SELECT COALESCE(SUM(helpful), 0) AS yes, COALESCE(SUM(1 - helpful), 0) AS no
       FROM docs_feedback WHERE page_id = ? AND user_id = ?`,
    )
    .get(pageId, ownerId)) as { yes: number; no: number } | undefined;
  return { yes: Number(row?.yes ?? 0), no: Number(row?.no ?? 0) };
}
