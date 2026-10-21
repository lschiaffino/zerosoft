/**
 * Board → Track: stickies convertidos en issues. Cada issue queda ligado al
 * elemento (board_track_links) y el editor lo muestra como tarjeta en vivo
 * sobre el sticky (estado, responsable), consultando cada tanto.
 *
 * El issue lleva el texto del sticky y un link de vuelta a la pizarra.
 */
import { getDb } from './db';
import { canAccessTrackProject, createIssue, getProject } from './track-data';
import { stickyIssueTitle } from './board-stickies';

export interface BoardTrackCard {
  element_id: string;
  issue_id: string;
  identifier: string;
  title: string;
  status_name: string | null;
  status_color: string | null;
  status_category: string | null;
  assignee_name: string | null;
}

/** Descripción del issue (Markdown de Track): el texto completo y el link a la pizarra. */
export function boardIssueDescription(text: string, boardId: string, boardName: string, fromLabel = 'From board'): string {
  const name = boardName.replace(/[[\]]/g, '').trim() || 'Board';
  return `${text.trim()}\n\n${fromLabel}: [${name}](/app/board/${encodeURIComponent(boardId)})`;
}

export type CreateFromStickiesResult =
  | { ok: true; created: BoardTrackCard[]; skipped: number }
  | { ok: false; code: 'project_not_found' };

/**
 * Crea un issue por sticky en el proyecto (que tiene que ser del workspace
 * activo). Un sticky que ya tiene issue no se duplica.
 */
export async function createIssuesFromStickies(args: {
  workspaceId: string;
  teamId: string | null;
  personId: string;
  boardId: string;
  boardName: string;
  projectId: string;
  items: Array<{ elementId: string; text: string }>;
  fromLabel?: string;
}): Promise<CreateFromStickiesResult> {
  const project = await getProject(args.projectId);
  if (!project || !canAccessTrackProject(project, args.teamId, args.workspaceId)) return { ok: false, code: 'project_not_found' };
  const linked = new Set((await listBoardTrackCards(args.boardId)).map((c) => c.element_id));
  let skipped = 0;
  const createdIds: string[] = [];
  for (const item of args.items) {
    const title = stickyIssueTitle(item.text);
    if (!title || linked.has(item.elementId)) {
      skipped += 1;
      continue;
    }
    linked.add(item.elementId);
    const issue = await createIssue(
      project.id,
      args.personId,
      {
        title,
        description: [{ type: 'text', text: boardIssueDescription(item.text, args.boardId, args.boardName, args.fromLabel) }],
      },
      { source: 'app' },
    );
    await getDb()
      .prepare(
        `INSERT INTO board_track_links (board_id, element_id, issue_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(board_id, element_id) DO UPDATE SET issue_id = excluded.issue_id`,
      )
      .run(args.boardId, item.elementId, issue.id, args.personId, new Date().toISOString());
    createdIds.push(issue.id);
  }
  const cards = await listBoardTrackCards(args.boardId);
  return { ok: true, created: cards.filter((c) => createdIds.includes(c.issue_id)), skipped };
}

/** Tarjetas en vivo: los issues ligados a elementos de la pizarra, con su estado actual. */
export async function listBoardTrackCards(boardId: string): Promise<BoardTrackCard[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT l.element_id, i.id AS issue_id, i.identifier, i.title, s.name AS status_name, s.color AS status_color,
              s.category AS status_category, u.name AS assignee_name, u.email AS assignee_email
       FROM board_track_links l
       JOIN track_issues i ON i.id = l.issue_id
       LEFT JOIN track_statuses s ON s.id = i.status_id
       LEFT JOIN users u ON u.id = i.assignee_id
       WHERE l.board_id = ?
       ORDER BY l.created_at`,
    )
    .all(boardId)) as Array<BoardTrackCard & { assignee_email: string | null }>;
  return rows.map(({ assignee_email, ...r }) => ({ ...r, assignee_name: r.assignee_name ?? assignee_email ?? null }));
}

/** Suelta el issue de un elemento (el issue sigue en Track). */
export async function unlinkBoardTrackCard(boardId: string, elementId: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM board_track_links WHERE board_id = ? AND element_id = ?').run(boardId, elementId);
  return res.changes > 0;
}
