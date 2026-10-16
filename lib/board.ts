import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { marked } from 'marked';
import { getDb } from './db';
import type { RoadmapCommentRow, RoadmapItemRow, RoadmapStatusEventRow } from './db';
import { PRODUCT_KEYS, type ProductKey } from './product-taxonomy';
import {
  BOARD_SORTS,
  ROADMAP_PUBLIC_STATUSES,
  ROADMAP_VOTABLE_STATUSES,
  isPublicStatus,
  type BoardSort,
  type RoadmapPublicStatus,
} from './roadmap-constants';
import { getRoadmapItem, recordStatusEvent, recountComments, recountVotes } from './roadmap';

/**
 * Board público de feedback (feedback.zerosoft.ai): listado con orden,
 * filtro y búsqueda, propuestas de ideas, votos por usuario (toggle),
 * comentarios y suscripciones. La moderación es posterior: lo que se propone
 * queda visible en 'idea' y un admin lo oculta (is_public = 0) o lo cierra.
 */

function nowIso(): string {
  return new Date().toISOString();
}

const PUBLIC_STATUS_SQL = ROADMAP_PUBLIC_STATUSES.map((s) => `'${s}'`).join(', ');
const TRENDING_DAYS = 14;

export type BoardItem = Pick<
  RoadmapItemRow,
  | 'id'
  | 'title'
  | 'description'
  | 'product'
  | 'kind'
  | 'status'
  | 'votes'
  | 'comment_count'
  | 'shipped_changelog_id'
  | 'declined_reason'
  | 'created_at'
  | 'updated_at'
> & { voted: boolean };

const ITEM_COLS =
  'i.id, i.title, i.description, i.product, i.kind, i.status, i.votes, i.comment_count, i.shipped_changelog_id, i.declined_reason, i.created_at, i.updated_at';

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface BoardQuery {
  q?: string | null;
  product?: string | null;
  status?: string | null;
  sort?: BoardSort;
  limit?: number;
  userId?: string | null;
}

export function parseBoardSort(value: unknown): BoardSort {
  return (BOARD_SORTS as readonly string[]).includes(String(value)) ? (value as BoardSort) : 'top';
}

/** Ítems públicos del board, con `voted` para la persona logueada. */
export async function listBoardItems(query: BoardQuery = {}): Promise<BoardItem[]> {
  const where: string[] = ['i.is_public = 1', `i.status IN (${PUBLIC_STATUS_SQL})`];
  const args: Array<string | number> = [];
  const q = (query.q ?? '').trim().slice(0, 120);
  if (q) {
    where.push("(i.title LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(q)}%`;
    args.push(like, like);
  }
  if (query.product && (PRODUCT_KEYS as readonly string[]).includes(query.product)) {
    where.push('i.product = ?');
    args.push(query.product);
  }
  if (query.status && isPublicStatus(query.status)) {
    where.push('i.status = ?');
    args.push(query.status);
  }
  const sort = query.sort ?? 'top';
  const since = new Date(Date.now() - TRENDING_DAYS * 86_400_000).toISOString();
  let order: string;
  const orderArgs: Array<string | number> = [];
  if (sort === 'new') order = 'i.created_at DESC';
  else if (sort === 'trending') {
    // Tendencia: votos y señales de las últimas dos semanas, después el total.
    order = `((SELECT COUNT(*) FROM roadmap_votes v WHERE v.item_id = i.id AND v.created_at >= ?) +
              (SELECT COUNT(*) FROM roadmap_signals s WHERE s.item_id = i.id AND s.created_at >= ?)) DESC, i.votes DESC, i.created_at DESC`;
    orderArgs.push(since, since);
  } else order = 'i.votes DESC, i.created_at DESC';
  const limit = Math.min(Math.max(query.limit ?? 200, 1), 500);
  const rows = (await getDb()
    .prepare(`SELECT ${ITEM_COLS} FROM roadmap_items i WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`)
    .all(...args, ...orderArgs, limit)) as Array<Omit<BoardItem, 'voted'>>;
  const voted = await votedSet(
    query.userId ?? null,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, votes: Number(r.votes), comment_count: Number(r.comment_count), voted: voted.has(r.id) }));
}

async function votedSet(userId: string | null, ids: string[]): Promise<Set<string>> {
  if (!userId || ids.length === 0) return new Set();
  const placeholders = ids.map(() => '?').join(', ');
  const rows = (await getDb()
    .prepare(`SELECT item_id FROM roadmap_votes WHERE user_id = ? AND item_id IN (${placeholders})`)
    .all(userId, ...ids)) as Array<{ item_id: string }>;
  return new Set(rows.map((r) => r.item_id));
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'add', 'make', 'can', 'should', 'would',
  'los', 'las', 'del', 'con', 'una', 'uno', 'que', 'por', 'para', 'como', 'poder', 'agregar', 'sumar',
  'dos', 'das', 'com', 'uma', 'por', 'para', 'adicionar', 'poder',
]);

export function searchTerms(text: string): string[] {
  const words = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, 8);
}

/**
 * Ítems parecidos a lo que la persona escribe (para votar en vez de
 * duplicar). Puntaje = palabras en común (título pesa doble), después votos.
 */
export async function findSimilarItems(text: string, userId: string | null = null, limit = 5): Promise<BoardItem[]> {
  const terms = searchTerms(text);
  if (terms.length === 0) return [];
  const conds = terms.map(() => "(lower(i.title) LIKE ? ESCAPE '\\' OR lower(i.description) LIKE ? ESCAPE '\\')");
  const args = terms.flatMap((t) => [`%${escapeLike(t)}%`, `%${escapeLike(t)}%`]);
  const rows = (await getDb()
    .prepare(
      `SELECT ${ITEM_COLS} FROM roadmap_items i
       WHERE i.is_public = 1 AND i.status IN (${PUBLIC_STATUS_SQL}) AND (${conds.join(' OR ')})
       ORDER BY i.votes DESC LIMIT 60`,
    )
    .all(...args)) as Array<Omit<BoardItem, 'voted'>>;
  const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const scored = rows
    .map((r) => {
      const title = fold(r.title);
      const desc = fold(r.description);
      const score = terms.reduce((acc, t) => acc + (title.includes(t) ? 2 : 0) + (desc.includes(t) ? 1 : 0), 0);
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.r.votes) - Number(a.r.votes))
    .slice(0, limit)
    .map((x) => x.r);
  const voted = await votedSet(userId, scored.map((r) => r.id));
  return scored.map((r) => ({ ...r, votes: Number(r.votes), comment_count: Number(r.comment_count), voted: voted.has(r.id) }));
}

/** Ítem visible en el board (público y en un estado público), o undefined. */
export async function getPublicItem(id: string): Promise<RoadmapItemRow | undefined> {
  const item = await getRoadmapItem(id);
  if (!item || item.is_public !== 1 || !isPublicStatus(item.status)) return undefined;
  return item;
}

// ---------- Ideas nuevas ----------

export const ideaSchema = z.object({
  title: z.string().trim().min(6).max(140),
  description: z.string().trim().max(4000).default(''),
  product: z.enum(PRODUCT_KEYS).default('other'),
  // Honeypot: input oculto que una persona nunca completa.
  website: z.string().optional(),
});

export type IdeaInput = z.infer<typeof ideaSchema>;

export async function createIdea(input: {
  userId: string;
  title: string;
  description: string;
  product: ProductKey;
  locale?: string;
}): Promise<RoadmapItemRow> {
  const id = crypto.randomUUID();
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO roadmap_items (id, title, description, product, kind, status, votes, is_public, author_id, status_changed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'idea', 'idea', 0, 1, ?, ?, ?, ?)`,
    )
    .run(id, input.title, input.description, input.product, input.userId, now, now, now);
  await recordStatusEvent(id, null, 'idea', { actorId: input.userId });
  // Quien propone vota su idea y queda suscripto.
  await toggleVote(id, input.userId, { locale: input.locale, force: 'on', reason: 'author' });
  return (await getRoadmapItem(id))!;
}

// ---------- Votos ----------

export type ToggleVoteResult = { ok: true; voted: boolean; votes: number } | { ok: false; error: 'not_found' | 'closed' };

/**
 * Votar / quitar el voto (un voto por usuario por ítem, UNIQUE en la base).
 * `force` fija el estado en vez de alternarlo. Votar suscribe al ítem.
 */
export async function toggleVote(
  itemId: string,
  userId: string,
  opts: { force?: 'on' | 'off'; locale?: string; reason?: 'vote' | 'author' } = {},
): Promise<ToggleVoteResult> {
  const item = await getRoadmapItem(itemId);
  if (!item || item.is_public !== 1 || !isPublicStatus(item.status)) return { ok: false, error: 'not_found' };
  if (!ROADMAP_VOTABLE_STATUSES.includes(item.status)) return { ok: false, error: 'closed' };
  const db = getDb();
  const existing = await db.prepare('SELECT id FROM roadmap_votes WHERE item_id = ? AND user_id = ?').get(itemId, userId);
  const want = opts.force ? opts.force === 'on' : !existing;
  if (want && !existing) {
    await db
      .prepare('INSERT OR IGNORE INTO roadmap_votes (id, item_id, user_id, ip_hash, created_at) VALUES (?, ?, ?, NULL, ?)')
      .run(crypto.randomUUID(), itemId, userId, nowIso());
    await subscribe(itemId, userId, opts.reason ?? 'vote', opts.locale);
  } else if (!want && existing) {
    await db.prepare('DELETE FROM roadmap_votes WHERE item_id = ? AND user_id = ?').run(itemId, userId);
  }
  const votes = await recountVotes(itemId);
  return { ok: true, voted: want, votes };
}

export async function hasVoted(itemId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  return Boolean(await getDb().prepare('SELECT 1 AS x FROM roadmap_votes WHERE item_id = ? AND user_id = ?').get(itemId, userId));
}

// ---------- Suscripciones ----------

function normLocale(locale: string | undefined | null): string {
  return locale === 'es' || locale === 'pt' ? locale : 'en';
}

/** Suscripción automática. Si la persona se desuscribió antes, no la reactiva. */
export async function subscribe(
  itemId: string,
  userId: string,
  reason: 'author' | 'vote' | 'comment' | 'manual',
  locale?: string | null,
): Promise<void> {
  await getDb()
    .prepare(
      `INSERT OR IGNORE INTO roadmap_subscriptions (item_id, user_id, reason, active, locale, created_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .run(itemId, userId, reason, normLocale(locale), nowIso());
}

/** Suscribirse o desuscribirse a mano (botón "Seguir" o link del email). */
export async function setSubscription(itemId: string, userId: string, active: boolean, locale?: string | null): Promise<void> {
  const db = getDb();
  await db
    .prepare(
      `INSERT INTO roadmap_subscriptions (item_id, user_id, reason, active, locale, created_at)
       VALUES (?, ?, 'manual', ?, ?, ?)
       ON CONFLICT (item_id, user_id) DO UPDATE SET active = excluded.active`,
    )
    .run(itemId, userId, active ? 1 : 0, normLocale(locale), nowIso());
}

export async function isSubscribed(itemId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const row = (await getDb()
    .prepare('SELECT active FROM roadmap_subscriptions WHERE item_id = ? AND user_id = ?')
    .get(itemId, userId)) as { active: number } | undefined;
  return Number(row?.active ?? 0) === 1;
}

// ---------- Comentarios ----------

export const COMMENT_MAX = 4000;

const COMMENT_SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'a'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { href: attribs.href ?? '', target: '_blank', rel: 'nofollow ugc noopener noreferrer' },
    }),
  },
};

/** Markdown chico (párrafos, listas, énfasis, código, links) → HTML sanitizado. */
export function renderCommentHtml(markdown: string): string {
  const raw = marked.parse(markdown.slice(0, COMMENT_MAX), { async: false, gfm: true, breaks: true }) as string;
  return sanitizeHtml(raw, COMMENT_SANITIZE).trim();
}

export interface CommentView {
  id: string;
  item_id: string;
  user_id: string | null;
  body: string;
  is_official: number;
  pinned: number;
  created_at: string;
  author_name: string | null;
  author_image: string | null;
}

export async function listComments(itemId: string): Promise<CommentView[]> {
  return (await getDb()
    .prepare(
      `SELECT c.id, c.item_id, c.user_id, c.body, c.is_official, c.pinned, c.created_at,
              u.name AS author_name, u.image AS author_image
       FROM roadmap_comments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.item_id = ?
       ORDER BY c.pinned DESC, c.created_at ASC`,
    )
    .all(itemId)) as CommentView[];
}

export async function getComment(id: string): Promise<RoadmapCommentRow | undefined> {
  return (await getDb().prepare('SELECT * FROM roadmap_comments WHERE id = ?').get(id)) as RoadmapCommentRow | undefined;
}

export type CommentResult =
  | { ok: true; comment: RoadmapCommentRow }
  | { ok: false; error: 'not_found' | 'invalid_input' | 'forbidden' };

export async function addComment(input: {
  itemId: string;
  userId: string;
  body: string;
  official?: boolean;
  isAdmin?: boolean;
  locale?: string;
}): Promise<CommentResult> {
  const item = await getPublicItem(input.itemId);
  if (!item) return { ok: false, error: 'not_found' };
  if (input.official && !input.isAdmin) return { ok: false, error: 'forbidden' };
  const html = renderCommentHtml(input.body.trim());
  if (!html || html.replace(/<[^>]+>/g, '').trim().length === 0) return { ok: false, error: 'invalid_input' };
  const id = crypto.randomUUID();
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO roadmap_comments (id, item_id, user_id, body, is_official, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, input.itemId, input.userId, html, input.official ? 1 : 0, now, now);
  await recountComments(input.itemId);
  await subscribe(input.itemId, input.userId, 'comment', input.locale);
  return { ok: true, comment: (await getComment(id))! };
}

/** Borrar: la autora del comentario o un admin. */
export async function deleteComment(id: string, userId: string, isAdmin: boolean): Promise<CommentResult> {
  const comment = await getComment(id);
  if (!comment) return { ok: false, error: 'not_found' };
  if (!isAdmin && comment.user_id !== userId) return { ok: false, error: 'forbidden' };
  await getDb().prepare('DELETE FROM roadmap_comments WHERE id = ?').run(id);
  await recountComments(comment.item_id);
  return { ok: true, comment };
}

/** Fijar / marcar como respuesta oficial: solo admins. */
export async function moderateComment(
  id: string,
  patch: { pinned?: boolean; official?: boolean },
  isAdmin: boolean,
): Promise<CommentResult> {
  if (!isAdmin) return { ok: false, error: 'forbidden' };
  const comment = await getComment(id);
  if (!comment) return { ok: false, error: 'not_found' };
  const fields: string[] = [];
  const args: Array<number | string> = [];
  if (patch.pinned !== undefined) {
    fields.push('pinned = ?');
    args.push(patch.pinned ? 1 : 0);
  }
  if (patch.official !== undefined) {
    fields.push('is_official = ?');
    args.push(patch.official ? 1 : 0);
  }
  if (fields.length > 0) {
    fields.push('updated_at = ?');
    args.push(nowIso());
    await getDb()
      .prepare(`UPDATE roadmap_comments SET ${fields.join(', ')} WHERE id = ?`)
      .run(...args, id);
  }
  return { ok: true, comment: (await getComment(id))! };
}

// ---------- Timeline ----------

export async function listStatusEvents(itemId: string): Promise<RoadmapStatusEventRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM roadmap_status_events WHERE item_id = ? ORDER BY created_at ASC')
    .all(itemId)) as RoadmapStatusEventRow[];
}

/** Para el resumen del board: cuántos ítems públicos hay por estado. */
export async function countByStatus(): Promise<Record<RoadmapPublicStatus, number>> {
  const rows = (await getDb()
    .prepare(
      `SELECT status, COUNT(*) AS n FROM roadmap_items WHERE is_public = 1 AND status IN (${PUBLIC_STATUS_SQL}) GROUP BY status`,
    )
    .all()) as Array<{ status: RoadmapPublicStatus; n: number }>;
  const out = Object.fromEntries(ROADMAP_PUBLIC_STATUSES.map((s) => [s, 0])) as Record<RoadmapPublicStatus, number>;
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}
