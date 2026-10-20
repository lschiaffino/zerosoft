import { z } from 'zod';
import { getDb } from './db';

/**
 * Comentarios internos de un link: notas del equipo ("esta es la campaña de
 * marzo", "no tocar el destino hasta el lunes"). Solo los ve el workspace;
 * nunca salen por la API pública ni por webhooks. Los borra quien los
 * escribió o un admin.
 */

export const MAX_COMMENT_LENGTH = 2000;

export const linkCommentSchema = z.object({
  body: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
});

export interface LinkCommentDto {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

interface CommentRow {
  id: string;
  body: string;
  author_id: string;
  created_at: string;
  name: string | null;
  email: string | null;
}

function toDto(r: CommentRow): LinkCommentDto {
  return { id: r.id, body: r.body, authorId: r.author_id, authorName: r.name || r.email || '', createdAt: r.created_at };
}

const SELECT = `SELECT c.id, c.body, c.author_id, c.created_at, u.name, u.email
  FROM link_comments c LEFT JOIN users u ON u.id = c.author_id`;

/** Comentarios del link, del más viejo al más nuevo (como un hilo). */
export async function listLinkComments(linkId: string, limit = 200): Promise<LinkCommentDto[]> {
  const rows = (await getDb()
    .prepare(`${SELECT} WHERE c.link_id = ? ORDER BY c.created_at, c.rowid LIMIT ?`)
    .all(linkId, limit)) as CommentRow[];
  return rows.map(toDto);
}

export async function countLinkComments(linkId: string): Promise<number> {
  return ((await getDb().prepare('SELECT COUNT(*) AS c FROM link_comments WHERE link_id = ?').get(linkId)) as { c: number }).c;
}

export async function addLinkComment(linkId: string, authorId: string, body: string): Promise<LinkCommentDto> {
  const id = crypto.randomUUID();
  await getDb()
    .prepare('INSERT INTO link_comments (id, link_id, author_id, body) VALUES (?, ?, ?, ?)')
    .run(id, linkId, authorId, body.trim().slice(0, MAX_COMMENT_LENGTH));
  const row = (await getDb().prepare(`${SELECT} WHERE c.id = ?`).get(id)) as CommentRow;
  return toDto(row);
}

/**
 * Borra un comentario del link. Solo su autor o un admin: devuelve
 * 'not_found' si no es de ese link y 'forbidden' si no le corresponde.
 */
export async function deleteLinkComment(
  linkId: string,
  commentId: string,
  actorId: string,
  isAdmin: boolean,
): Promise<'ok' | 'not_found' | 'forbidden'> {
  const row = (await getDb()
    .prepare('SELECT author_id FROM link_comments WHERE id = ? AND link_id = ?')
    .get(commentId, linkId)) as { author_id: string } | undefined;
  if (!row) return 'not_found';
  if (row.author_id !== actorId && !isAdmin) return 'forbidden';
  await getDb().prepare('DELETE FROM link_comments WHERE id = ?').run(commentId);
  return 'ok';
}
