import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import sanitizeHtml from 'sanitize-html';
import { marked } from 'marked';
import { getDb } from './db';
import type { ChangelogEntryRow } from './db';
import { CHANGELOG, type ChangelogEntry, type ChangelogItem, type Localized } from '@/content/changelog';
import { PRODUCT_KEYS, isProductKey, type ProductKey } from './product-taxonomy';
import { slugifyTitle } from './roadmap-constants';
import { getRoadmapItem, updateRoadmapItem } from './roadmap';

/**
 * Changelog = content/changelog.ts (historial en el repo) + changelog_entries
 * (lo que el equipo publica desde el admin, sin deploy). La página /changelog,
 * el feed y la sección Novedades muestran la unión ordenada por fecha. Cada
 * entrada lista los ítems del roadmap que cerró (shipped_changelog_id).
 */

export interface ClosedItem {
  id: string;
  title: string;
}

export interface UnifiedChangelogEntry {
  id: string;
  date: string; // yyyy-mm-dd
  source: 'static' | 'db';
  title: Localized;
  /** Ítems por producto (entradas del repo). */
  items: ChangelogItem[];
  /** Cuerpo en HTML sanitizado por idioma (entradas de la base). */
  body: Localized | null;
  products: ProductKey[];
  closed: ClosedItem[];
  /** Orden dentro del mismo día (más alto = más arriba). */
  rank: number;
}

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'a', 'h3', 'h4'],
  allowedAttributes: { a: ['href', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    h1: 'h3',
    h2: 'h3',
    a: (tagName, attribs) => ({ tagName, attribs: { href: attribs.href ?? '', rel: 'noopener' } }),
  },
};

export function renderChangelogMarkdown(md: string): string {
  if (!md.trim()) return '';
  return sanitizeHtml(marked.parse(md, { async: false, gfm: true }) as string, SANITIZE).trim();
}

function parseProducts(raw: string): ProductKey[] {
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter(isProductKey) : [];
  } catch {
    return [];
  }
}

export function dbRowToEntry(row: ChangelogEntryRow, rank: number): UnifiedChangelogEntry {
  const en = row.title_en;
  return {
    id: row.id,
    date: row.date,
    source: 'db',
    title: { en, es: row.title_es || en, pt: row.title_pt || en },
    items: [],
    body: {
      en: renderChangelogMarkdown(row.body_en),
      es: renderChangelogMarkdown(row.body_es || row.body_en),
      pt: renderChangelogMarkdown(row.body_pt || row.body_en),
    },
    products: parseProducts(row.products),
    closed: [],
    rank,
  };
}

export function staticToEntry(e: ChangelogEntry, rank: number): UnifiedChangelogEntry {
  const products = [...new Set(e.items.map((i) => i.product))];
  return { id: e.id, date: e.date, source: 'static', title: e.title, items: e.items, body: null, products, closed: [], rank };
}

/**
 * Une las entradas del repo y de la base: fecha descendente; en el mismo día
 * las de la base (publicadas después del deploy) van arriba, y cada grupo
 * mantiene su orden. Si un id choca, gana la del repo.
 */
export function mergeChangelog(
  staticEntries: ChangelogEntry[],
  dbRows: ChangelogEntryRow[],
  closedByEntry: Map<string, ClosedItem[]> = new Map(),
): UnifiedChangelogEntry[] {
  const staticIds = new Set(staticEntries.map((e) => e.id));
  const fromStatic = staticEntries.map((e, i) => staticToEntry(e, -i));
  // dbRows vienen más nuevas primero: rank alto = arriba.
  const fromDb = dbRows.filter((r) => !staticIds.has(r.id)).map((r, i) => dbRowToEntry(r, 1_000_000 - i));
  return [...fromStatic, ...fromDb]
    .map((e) => ({ ...e, closed: closedByEntry.get(e.id) ?? [] }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.rank - a.rank);
}

export async function listChangelogRows(opts: { includeDrafts?: boolean } = {}): Promise<ChangelogEntryRow[]> {
  const sql = opts.includeDrafts
    ? 'SELECT * FROM changelog_entries ORDER BY date DESC, created_at DESC LIMIT 500'
    : 'SELECT * FROM changelog_entries WHERE published = 1 ORDER BY date DESC, created_at DESC LIMIT 500';
  return (await getDb().prepare(sql).all()) as ChangelogEntryRow[];
}

export async function getChangelogRow(id: string): Promise<ChangelogEntryRow | undefined> {
  return (await getDb().prepare('SELECT * FROM changelog_entries WHERE id = ?').get(id)) as ChangelogEntryRow | undefined;
}

/** Ítems públicos que cerró cada entrada (roadmap_items.shipped_changelog_id). */
export async function closedItemsByEntry(): Promise<Map<string, ClosedItem[]>> {
  const rows = (await getDb()
    .prepare(
      `SELECT id, title, shipped_changelog_id FROM roadmap_items
       WHERE shipped_changelog_id IS NOT NULL AND is_public = 1 AND status = 'done'
       ORDER BY votes DESC`,
    )
    .all()) as Array<{ id: string; title: string; shipped_changelog_id: string }>;
  const out = new Map<string, ClosedItem[]>();
  for (const r of rows) {
    const list = out.get(r.shipped_changelog_id) ?? [];
    list.push({ id: r.id, title: r.title });
    out.set(r.shipped_changelog_id, list);
  }
  return out;
}

/** Changelog completo (repo + base). Si la base falla, al menos el del repo. */
export async function getUnifiedChangelog(): Promise<UnifiedChangelogEntry[]> {
  try {
    const [rows, closed] = await Promise.all([listChangelogRows(), closedItemsByEntry()]);
    return mergeChangelog(CHANGELOG, rows, closed);
  } catch (err) {
    console.error('[changelog] db entries unavailable', err);
    return mergeChangelog(CHANGELOG, []);
  }
}

// ---------- Admin ----------

export const changelogInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  titleEn: z.string().trim().min(1).max(200),
  titleEs: z.string().trim().max(200).default(''),
  titlePt: z.string().trim().max(200).default(''),
  bodyEn: z.string().max(20000).default(''),
  bodyEs: z.string().max(20000).default(''),
  bodyPt: z.string().max(20000).default(''),
  products: z.array(z.enum(PRODUCT_KEYS)).max(PRODUCT_KEYS.length).default([]),
  published: z.boolean().default(true),
  closesItemIds: z.array(z.string().min(1).max(80)).max(50).default([]),
});

export type ChangelogInput = z.infer<typeof changelogInputSchema>;

async function uniqueEntryId(date: string, title: string): Promise<string> {
  const base = `${date}-${slugifyTitle(title)}`.slice(0, 100);
  const taken = new Set(CHANGELOG.map((e) => e.id));
  let id = base;
  for (let n = 2; ; n += 1) {
    if (!taken.has(id) && !(await getChangelogRow(id))) return id;
    id = `${base}-${n}`;
  }
}

/**
 * Pasa a 'done' los ítems que cierra la entrada y los vincula a ella. El
 * cambio de estado notifica a los suscriptos (updateRoadmapItem).
 */
export async function closeItemsForEntry(entryId: string, itemIds: string[], actorId: string | null): Promise<string[]> {
  const closed: string[] = [];
  for (const itemId of [...new Set(itemIds)]) {
    const item = await getRoadmapItem(itemId);
    if (!item) continue;
    await updateRoadmapItem(
      itemId,
      // Lo que sale en el changelog es público: el ítem pasa a verse en el board.
      { status: 'done', shippedChangelogId: entryId, isPublic: true },
      { actorId, changelogId: entryId },
    );
    closed.push(itemId);
  }
  return closed;
}

export async function createChangelogEntry(input: ChangelogInput, actorId: string | null): Promise<ChangelogEntryRow> {
  const id = await uniqueEntryId(input.date, input.titleEn);
  const now = new Date().toISOString();
  await getDb()
    .prepare(
      `INSERT INTO changelog_entries (id, date, title_en, title_es, title_pt, body_en, body_es, body_pt, products, published, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.date,
      input.titleEn,
      input.titleEs,
      input.titlePt,
      input.bodyEn,
      input.bodyEs,
      input.bodyPt,
      JSON.stringify(input.products),
      input.published ? 1 : 0,
      actorId,
      now,
      now,
    );
  if (input.published && input.closesItemIds.length > 0) await closeItemsForEntry(id, input.closesItemIds, actorId);
  return (await getChangelogRow(id))!;
}

export async function updateChangelogEntry(
  id: string,
  input: ChangelogInput,
  actorId: string | null,
): Promise<ChangelogEntryRow | undefined> {
  const existing = await getChangelogRow(id);
  if (!existing) return undefined;
  await getDb()
    .prepare(
      `UPDATE changelog_entries SET date = ?, title_en = ?, title_es = ?, title_pt = ?, body_en = ?, body_es = ?, body_pt = ?,
         products = ?, published = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      input.date,
      input.titleEn,
      input.titleEs,
      input.titlePt,
      input.bodyEn,
      input.bodyEs,
      input.bodyPt,
      JSON.stringify(input.products),
      input.published ? 1 : 0,
      new Date().toISOString(),
      id,
    );
  if (input.published && input.closesItemIds.length > 0) await closeItemsForEntry(id, input.closesItemIds, actorId);
  return getChangelogRow(id);
}

/** Borra la entrada. Los ítems que cerró quedan hechos, sin link. */
export async function deleteChangelogEntry(id: string): Promise<boolean> {
  const db = getDb();
  const res = await db.prepare('DELETE FROM changelog_entries WHERE id = ?').run(id);
  if (res.changes > 0) {
    await db.prepare('UPDATE roadmap_items SET shipped_changelog_id = NULL WHERE shipped_changelog_id = ?').run(id);
  }
  return res.changes > 0;
}

/** Invalida el feed (revalidate) después de publicar. Fuera de una request no hace nada. */
export function revalidateChangelog(): void {
  try {
    for (const l of ['en', 'es', 'pt']) revalidatePath(`/${l}/changelog/feed.xml`);
  } catch {
    // sin caché que invalidar (tests, scripts)
  }
}

export async function itemIdsForEntry(id: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare('SELECT id FROM roadmap_items WHERE shipped_changelog_id = ?')
    .all(id)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}
