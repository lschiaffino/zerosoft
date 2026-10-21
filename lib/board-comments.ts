/**
 * Board — hilos de comentarios anclados al lienzo. Cada hilo es un punto de
 * la escena (coordenadas de Excalidraw, no de la pantalla) con una lista de
 * comentarios en Markdown; se resuelve y se reabre. Las @menciones avisan a la
 * persona mencionada y una respuesta avisa a quienes ya escribieron en el hilo.
 *
 * Como las pizarras, los hilos son del workspace: cualquiera del team los ve,
 * responde y resuelve. Borrar un comentario es solo de su autora.
 */
import { getDb, getUserById, type BoardCommentRow, type BoardCommentThreadRow } from './db';
import { listMembers, listOwnedTeams } from './teams';
import { createNotification } from './notifications';
import { renderTrackMarkdown } from './track-markdown';
import { getBoardName } from './boards';
import { emitEventSoon } from './events';

const nowIso = () => new Date().toISOString();

export interface BoardMember {
  id: string;
  name: string | null;
  email: string;
}

export interface BoardCommentView {
  id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  body_html: string;
  created_at: string;
  updated_at: string;
}

export interface BoardThreadView {
  id: string;
  x: number;
  y: number;
  element_id: string | null;
  created_by: string | null;
  resolved_at: string | null;
  resolved_by_name: string | null;
  created_at: string;
  comments: BoardCommentView[];
}

/** Quienes se pueden mencionar: el dueño del workspace y los miembros de sus teams. */
export async function listBoardMembers(workspaceId: string): Promise<BoardMember[]> {
  const out = new Map<string, BoardMember>();
  const owner = await getUserById(workspaceId);
  if (owner) out.set(owner.id, { id: owner.id, name: owner.name, email: owner.email });
  for (const team of await listOwnedTeams(workspaceId)) {
    for (const m of await listMembers(team.id)) {
      if (!out.has(m.user_id)) out.set(m.user_id, { id: m.user_id, name: m.name, email: m.email });
    }
  }
  return [...out.values()];
}

/** Texto que inserta el autocompletado: @Nombre si tiene, si no @email. */
export function mentionToken(member: Pick<BoardMember, 'name' | 'email'>): string {
  const name = member.name?.trim();
  return `@${name || member.email}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ids de las personas mencionadas en el texto (@Nombre completo o @email, sin
 * importar mayúsculas). El nombre tiene que terminar ahí: "@Ana" no menciona a
 * "Ana Paula" si existe, y gana el nombre más largo que coincide.
 */
export function resolveMentions(body: string, members: BoardMember[]): string[] {
  const found = new Set<string>();
  const candidates = members
    .flatMap((m) => [m.email, m.name?.trim()].filter((s): s is string => Boolean(s)).map((label) => ({ id: m.id, label })))
    .sort((a, b) => b.label.length - a.label.length);
  let text = body;
  for (const c of candidates) {
    const re = new RegExp(`(^|[^\\w@])@${escapeRe(c.label)}(?![\\w-]|\\.\\w)`, 'gi');
    if (re.test(text)) {
      found.add(c.id);
      // Lo que ya coincidió no vuelve a contar para un nombre más corto.
      text = text.replace(re, '$1');
    }
  }
  return [...found];
}

type CommentJoinRow = BoardCommentRow & { author_name: string | null; author_email: string | null };

function toCommentView(r: CommentJoinRow): BoardCommentView {
  return {
    id: r.id,
    author_id: r.author_id,
    author_name: r.author_name ?? r.author_email ?? null,
    body: r.body,
    body_html: renderTrackMarkdown(r.body),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function listThreads(workspaceId: string, boardId: string): Promise<BoardThreadView[]> {
  const db = getDb();
  const threads = (await db
    .prepare(
      `SELECT t.*, u.name AS resolved_by_name, u.email AS resolved_by_email
       FROM board_comment_threads t LEFT JOIN users u ON u.id = t.resolved_by
       WHERE t.board_id = ? AND t.workspace_id = ? ORDER BY t.created_at ASC LIMIT 1000`,
    )
    .all(boardId, workspaceId)) as Array<BoardCommentThreadRow & { resolved_by_name: string | null; resolved_by_email: string | null }>;
  if (threads.length === 0) return [];
  const comments = (await db
    .prepare(
      `SELECT c.*, u.name AS author_name, u.email AS author_email
       FROM board_comments c LEFT JOIN users u ON u.id = c.author_id
       WHERE c.board_id = ? ORDER BY c.created_at ASC`,
    )
    .all(boardId)) as CommentJoinRow[];
  const byThread = new Map<string, BoardCommentView[]>();
  for (const c of comments) {
    const list = byThread.get(c.thread_id) ?? [];
    list.push(toCommentView(c));
    byThread.set(c.thread_id, list);
  }
  return threads.map((t) => ({
    id: t.id,
    x: Number(t.x),
    y: Number(t.y),
    element_id: t.element_id,
    created_by: t.created_by,
    resolved_at: t.resolved_at,
    resolved_by_name: t.resolved_by_name ?? t.resolved_by_email ?? null,
    created_at: t.created_at,
    comments: byThread.get(t.id) ?? [],
  }));
}

export async function getThread(workspaceId: string, boardId: string, threadId: string): Promise<BoardThreadView | null> {
  return (await listThreads(workspaceId, boardId)).find((t) => t.id === threadId) ?? null;
}

async function threadRow(workspaceId: string, boardId: string, threadId: string): Promise<BoardCommentThreadRow | undefined> {
  return (await getDb()
    .prepare('SELECT * FROM board_comment_threads WHERE id = ? AND board_id = ? AND workspace_id = ?')
    .get(threadId, boardId, workspaceId)) as BoardCommentThreadRow | undefined;
}

async function insertComment(threadId: string, boardId: string, authorId: string, body: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = nowIso();
  await getDb()
    .prepare('INSERT INTO board_comments (id, thread_id, board_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, threadId, boardId, authorId, body.trim(), now, now);
  await getDb().prepare('UPDATE board_comment_threads SET updated_at = ? WHERE id = ?').run(now, threadId);
  return id;
}

/**
 * Avisos de un comentario nuevo: menciones (a quien esté en el workspace) y,
 * en una respuesta, a quienes ya escribieron en el hilo. Nunca a quien escribe
 * y nunca dos avisos a la misma persona.
 */
async function notifyComment(args: {
  workspaceId: string;
  boardId: string;
  threadId: string;
  actorId: string;
  body: string;
  isReply: boolean;
}): Promise<void> {
  const actor = await getUserById(args.actorId);
  const boardName = (await getBoardName(args.workspaceId, args.boardId)) ?? 'Untitled board';
  const actorName = actor?.name ?? actor?.email ?? 'Someone';
  const href = `/app/board/${args.boardId}?comment=${args.threadId}`;
  // Solo quienes pueden ver la pizarra (en una restringida, no todo el workspace).
  const { boardAudience } = await import('./board-access');
  const members = await boardAudience(args.workspaceId, args.boardId);
  const notified = new Set<string>([args.actorId]);
  const excerpt = args.body.replace(/\s+/g, ' ').trim().slice(0, 140);
  const meta = { boardName, actorName, actorId: args.actorId, threadId: args.threadId };
  for (const userId of resolveMentions(args.body, members)) {
    if (notified.has(userId)) continue;
    notified.add(userId);
    await createNotification({
      userId,
      type: 'mention',
      title: `${actorName} mentioned you in ${boardName}`,
      body: excerpt,
      href,
      sourceType: 'board_comment',
      sourceId: args.threadId,
      meta,
    });
  }
  if (!args.isReply) return;
  const authors = (await getDb()
    .prepare('SELECT DISTINCT author_id FROM board_comments WHERE thread_id = ? AND author_id IS NOT NULL')
    .all(args.threadId)) as Array<{ author_id: string }>;
  const memberIds = new Set(members.map((m) => m.id));
  for (const { author_id } of authors) {
    // Quien ya no puede ver la pizarra (o dejó el workspace) no recibe avisos.
    if (notified.has(author_id) || !memberIds.has(author_id)) continue;
    notified.add(author_id);
    await createNotification({
      userId: author_id,
      type: 'comment',
      title: `${actorName} replied on ${boardName}`,
      body: excerpt,
      href,
      sourceType: 'board_comment',
      sourceId: args.threadId,
      meta,
    });
  }
}

export async function createThread(
  workspaceId: string,
  boardId: string,
  personId: string,
  input: { x: number; y: number; elementId?: string | null; body: string },
): Promise<BoardThreadView> {
  const id = crypto.randomUUID();
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO board_comment_threads (id, board_id, workspace_id, x, y, element_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, boardId, workspaceId, input.x, input.y, input.elementId ?? null, personId, now, now);
  const commentId = await insertComment(id, boardId, personId, input.body);
  await notifyComment({ workspaceId, boardId, threadId: id, actorId: personId, body: input.body, isReply: false });
  await emitCommentEvent(workspaceId, boardId, id, commentId, personId, input.body, false);
  return (await getThread(workspaceId, boardId, id))!;
}

export async function replyToThread(
  workspaceId: string,
  boardId: string,
  threadId: string,
  personId: string,
  body: string,
): Promise<BoardThreadView | null> {
  const t = await threadRow(workspaceId, boardId, threadId);
  if (!t) return null;
  const commentId = await insertComment(threadId, boardId, personId, body);
  // Responder un hilo resuelto lo reabre: la conversación sigue.
  if (t.resolved_at) {
    await getDb().prepare('UPDATE board_comment_threads SET resolved_at = NULL, resolved_by = NULL WHERE id = ?').run(threadId);
  }
  await notifyComment({ workspaceId, boardId, threadId, actorId: personId, body, isReply: true });
  await emitCommentEvent(workspaceId, boardId, threadId, commentId, personId, body, true);
  return getThread(workspaceId, boardId, threadId);
}

/** Disparador de Flow board.comment_created (hilo nuevo o respuesta). */
async function emitCommentEvent(
  workspaceId: string,
  boardId: string,
  threadId: string,
  commentId: string,
  authorId: string,
  body: string,
  isReply: boolean,
): Promise<void> {
  const name = (await getBoardName(workspaceId, boardId)) ?? '';
  await emitEventSoon(workspaceId, 'board.comment_created', {
    board: { id: boardId, name },
    thread: { id: threadId, isReply },
    comment: { id: commentId, body: body.trim().slice(0, 5000), authorId },
  });
}

export async function updateThread(
  workspaceId: string,
  boardId: string,
  threadId: string,
  personId: string,
  patch: { resolved?: boolean; x?: number; y?: number },
): Promise<BoardThreadView | null> {
  const t = await threadRow(workspaceId, boardId, threadId);
  if (!t) return null;
  const now = nowIso();
  if (patch.resolved !== undefined) {
    await getDb()
      .prepare('UPDATE board_comment_threads SET resolved_at = ?, resolved_by = ?, updated_at = ? WHERE id = ?')
      .run(patch.resolved ? now : null, patch.resolved ? personId : null, now, threadId);
  }
  if (patch.x !== undefined && patch.y !== undefined) {
    await getDb().prepare('UPDATE board_comment_threads SET x = ?, y = ?, updated_at = ? WHERE id = ?').run(patch.x, patch.y, now, threadId);
  }
  return getThread(workspaceId, boardId, threadId);
}

export type DeleteCommentResult = { ok: true; threadDeleted: boolean } | { ok: false; code: 'not_found' | 'forbidden' };

/** Borra un comentario propio; si era el último del hilo, el hilo se va con él. */
export async function deleteBoardComment(
  workspaceId: string,
  boardId: string,
  threadId: string,
  commentId: string,
  personId: string,
): Promise<DeleteCommentResult> {
  if (!(await threadRow(workspaceId, boardId, threadId))) return { ok: false, code: 'not_found' };
  const c = (await getDb()
    .prepare('SELECT author_id FROM board_comments WHERE id = ? AND thread_id = ?')
    .get(commentId, threadId)) as { author_id: string | null } | undefined;
  if (!c) return { ok: false, code: 'not_found' };
  if (c.author_id !== personId) return { ok: false, code: 'forbidden' };
  await getDb().prepare('DELETE FROM board_comments WHERE id = ?').run(commentId);
  const left = (await getDb().prepare('SELECT COUNT(*) AS n FROM board_comments WHERE thread_id = ?').get(threadId)) as { n: number };
  if (Number(left.n) === 0) {
    await getDb().prepare('DELETE FROM board_comment_threads WHERE id = ?').run(threadId);
    return { ok: true, threadDeleted: true };
  }
  return { ok: true, threadDeleted: false };
}
