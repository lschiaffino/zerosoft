/**
 * Notes: consola de admin del workspace (owner y admin). Muestra cuánto usa
 * cada persona, qué notas tienen link público y qué se comparte, sin abrir
 * contenido: las notas privadas siguen siendo de cada uno. Deja apagar un link
 * público y pasar todas las notas de una persona a otra (cuando alguien se va).
 * Server-only.
 */
import { getDb } from './db';
import { listBoardMembers } from './board-comments';

export interface NotesAdminMember {
  id: string;
  name: string | null;
  email: string;
  notes: number;
  notebooks: number;
  shares: number;
  public_links: number;
  last_update: string | null;
}

export interface NotesAdminLink {
  note_id: string;
  title: string;
  owner: string;
  token: string;
  updated_at: string;
}

export async function notesAdminOverview(workspaceId: string): Promise<{ members: NotesAdminMember[]; links: NotesAdminLink[] }> {
  const db = getDb();
  const people = await listBoardMembers(workspaceId);
  const stats = (await db
    .prepare(
      `SELECT person_id, COUNT(*) AS notes, SUM(CASE WHEN share_token IS NOT NULL THEN 1 ELSE 0 END) AS links, MAX(updated_at) AS last_update
       FROM notes WHERE workspace_id = ? AND trashed_at IS NULL GROUP BY person_id`,
    )
    .all(workspaceId)) as Array<{ person_id: string; notes: number; links: number; last_update: string | null }>;
  const notebooks = (await db.prepare('SELECT person_id, COUNT(*) AS c FROM note_notebooks WHERE workspace_id = ? GROUP BY person_id').all(workspaceId)) as Array<{ person_id: string; c: number }>;
  const shares = (await db
    .prepare(
      `SELECT n.person_id, COUNT(*) AS c FROM note_shares s JOIN notes n ON n.id = s.note_id
       WHERE n.workspace_id = ? AND n.trashed_at IS NULL GROUP BY n.person_id`,
    )
    .all(workspaceId)) as Array<{ person_id: string; c: number }>;
  const members: NotesAdminMember[] = people.map((p) => {
    const s = stats.find((x) => x.person_id === p.id);
    return {
      id: p.id,
      name: p.name ?? null,
      email: p.email,
      notes: Number(s?.notes ?? 0),
      notebooks: Number(notebooks.find((x) => x.person_id === p.id)?.c ?? 0),
      shares: Number(shares.find((x) => x.person_id === p.id)?.c ?? 0),
      public_links: Number(s?.links ?? 0),
      last_update: s?.last_update ?? null,
    };
  });
  const rows = (await db
    .prepare(
      `SELECT n.id AS note_id, n.title, n.share_token AS token, n.updated_at, COALESCE(u.name, u.email, '') AS owner
       FROM notes n LEFT JOIN users u ON u.id = n.person_id
       WHERE n.workspace_id = ? AND n.share_token IS NOT NULL AND n.trashed_at IS NULL ORDER BY n.updated_at DESC LIMIT 200`,
    )
    .all(workspaceId)) as NotesAdminLink[];
  return { members, links: rows };
}

export async function adminDisableLink(workspaceId: string, noteId: string): Promise<boolean> {
  const res = await getDb().prepare('UPDATE notes SET share_token = NULL WHERE id = ? AND workspace_id = ?').run(noteId, workspaceId);
  return res.changes > 0;
}

/**
 * Pasa notas, libretas, plantillas y búsquedas guardadas de una persona a otra.
 * Una nota bloqueada sigue bloqueada: solo la abre quien sepa la contraseña.
 */
export async function adminTransferNotes(workspaceId: string, from: string, to: string): Promise<number | 'not_member'> {
  const people = await listBoardMembers(workspaceId);
  if (from === to || !people.some((p) => p.id === to) || !people.some((p) => p.id === from)) return 'not_member';
  const db = getDb();
  const res = await db.prepare('UPDATE notes SET person_id = ? WHERE workspace_id = ? AND person_id = ?').run(to, workspaceId, from);
  for (const table of ['note_notebooks', 'note_templates', 'note_saved_searches']) {
    await db.prepare(`UPDATE ${table} SET person_id = ? WHERE workspace_id = ? AND person_id = ?`).run(to, workspaceId, from);
  }
  // Un share de la nueva dueña consigo misma no tiene sentido.
  await db.prepare('DELETE FROM note_shares WHERE person_id = ? AND note_id IN (SELECT id FROM notes WHERE workspace_id = ? AND person_id = ?)').run(to, workspaceId, to);
  return res.changes;
}
