/**
 * Notes: consola de admin del workspace (owner y admin). Muestra cuánto usa
 * cada persona, qué notas tienen link público y qué se comparte, sin abrir
 * contenido: las notas privadas siguen siendo de cada uno. Deja apagar un link
 * público y pasar las notas de alguien que ya se fue del workspace a otra
 * persona; nunca de un miembro activo ni del dueño, ni a quien hace el pase.
 * Cada acción queda en note_admin_audit. Server-only.
 */
import { ensureMigrated, getClient, getDb, txDb } from './db';
import { listBoardMembers } from './board-comments';
import { createNotification } from './notifications';
import { setNoteOcrEnabled } from './notes-file-text';
import { listMembers, listOwnedTeams } from './teams';

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

export interface NotesAdminAuditEntry {
  id: string;
  actor: string;
  action: 'disable_link' | 'transfer' | 'ocr';
  detail: Record<string, unknown>;
  created_at: string;
}

async function audit(workspaceId: string, actorId: string, action: NotesAdminAuditEntry['action'], detail: Record<string, unknown>): Promise<void> {
  await getDb()
    .prepare('INSERT INTO note_admin_audit (id, workspace_id, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), workspaceId, actorId, action, JSON.stringify(detail), new Date().toISOString());
}

/** Quienes siguen en el workspace, también como guest: un guest no "se fue". */
async function currentPeople(workspaceId: string): Promise<Set<string>> {
  const ids = new Set([workspaceId]);
  for (const team of await listOwnedTeams(workspaceId)) {
    for (const m of await listMembers(team.id, { includeGuests: true })) ids.add(m.user_id);
  }
  return ids;
}

export async function adminSetOcr(workspaceId: string, actorId: string, enabled: boolean): Promise<void> {
  await setNoteOcrEnabled(workspaceId, enabled);
  await audit(workspaceId, actorId, 'ocr', { enabled });
}

export async function listNotesAdminAudit(workspaceId: string, limit = 20): Promise<NotesAdminAuditEntry[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT a.id, COALESCE(u.name, u.email, '') AS actor, a.action, a.detail, a.created_at FROM note_admin_audit a
       LEFT JOIN users u ON u.id = a.actor_id WHERE a.workspace_id = ? ORDER BY a.created_at DESC, a.id LIMIT ?`,
    )
    .all(workspaceId, limit)) as Array<Omit<NotesAdminAuditEntry, 'detail'> & { detail: string }>;
  return rows.map((r) => ({ ...r, detail: JSON.parse(r.detail) as Record<string, unknown> }));
}

export async function notesAdminOverview(workspaceId: string): Promise<{
  members: NotesAdminMember[];
  former: NotesAdminMember[];
  links: NotesAdminLink[];
  audit: NotesAdminAuditEntry[];
}> {
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
  const row = (p: { id: string; name?: string | null; email: string }): NotesAdminMember => {
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
  };
  const current = await currentPeople(workspaceId);
  // También con todo en la papelera: esas notas igual hay que poder recuperarlas.
  const anyNote = (await db.prepare('SELECT DISTINCT person_id FROM notes WHERE workspace_id = ?').all(workspaceId)) as Array<{ person_id: string }>;
  const formerIds = [...new Set([...anyNote.map((s) => s.person_id), ...notebooks.map((n) => n.person_id)])].filter((id) => !current.has(id));
  const formerUsers = formerIds.length
    ? ((await db.prepare(`SELECT id, name, email FROM users WHERE id IN (${formerIds.map(() => '?').join(',')})`).all(...formerIds)) as Array<{ id: string; name: string | null; email: string }>)
    : [];
  const links = (await db
    .prepare(
      `SELECT n.id AS note_id, n.title, n.share_token AS token, n.updated_at, COALESCE(u.name, u.email, '') AS owner
       FROM notes n LEFT JOIN users u ON u.id = n.person_id
       WHERE n.workspace_id = ? AND n.share_token IS NOT NULL AND n.trashed_at IS NULL ORDER BY n.updated_at DESC LIMIT 200`,
    )
    .all(workspaceId)) as NotesAdminLink[];
  return { members: people.map(row), former: formerUsers.map(row), links, audit: await listNotesAdminAudit(workspaceId) };
}

export async function adminDisableLink(workspaceId: string, actorId: string, noteId: string): Promise<boolean> {
  const res = await getDb().prepare('UPDATE notes SET share_token = NULL WHERE id = ? AND workspace_id = ? AND share_token IS NOT NULL').run(noteId, workspaceId);
  if (res.changes === 0) return false;
  await audit(workspaceId, actorId, 'disable_link', { note_id: noteId });
  return true;
}

export type TransferError = 'not_former' | 'owner' | 'self' | 'not_member';

/**
 * Pasa notas, libretas, plantillas, búsquedas guardadas y recordatorios de alguien
 * que se fue a una persona del workspace, de una sola vez (transacción). Nadie gana
 * ni pierde acceso: los compartidos siguen cubriendo las mismas notas. Por eso una
 * libreta con shares (de cualquiera de los dos lados) nunca se une: queda aparte con
 * un sufijo; solo se unen las de igual nombre sin shares. Una nota bloqueada sigue
 * bloqueada: solo la abre quien sepa la contraseña. Quien hace el pase solo puede
 * quedarse con las notas si no hay nadie más en el workspace.
 */
export async function adminTransferNotes(workspaceId: string, actorId: string, from: string, to: string): Promise<number | TransferError> {
  if (from === workspaceId) return 'owner';
  if (from === to) return 'not_former';
  if ((await currentPeople(workspaceId)).has(from)) return 'not_former';
  const people = await listBoardMembers(workspaceId);
  if (!people.some((p) => p.id === to)) return 'not_member';
  if (to === actorId && people.some((p) => p.id !== actorId)) return 'self';
  const db = getDb();
  const has = (await db
    .prepare('SELECT (SELECT COUNT(*) FROM notes WHERE workspace_id = ? AND person_id = ?) + (SELECT COUNT(*) FROM note_notebooks WHERE workspace_id = ? AND person_id = ?) AS c')
    .get(workspaceId, from, workspaceId, from)) as { c: number };
  // Alguien que nunca tuvo nada acá: no hay pase ni registro.
  if (!Number(has.c)) return 'not_former';
  const leaver = (await db.prepare('SELECT name, email FROM users WHERE id = ?').get(from)) as { name: string | null; email: string } | undefined;
  const leaverName = leaver?.name || leaver?.email || '';

  await ensureMigrated();
  const tx = await getClient().transaction('write');
  const t = txDb(tx);
  let moved = 0;
  try {
    const fromBooks = (await t.prepare('SELECT id, name FROM note_notebooks WHERE workspace_id = ? AND person_id = ?').all(workspaceId, from)) as Array<{ id: string; name: string }>;
    const toBooks = (await t.prepare('SELECT id, name FROM note_notebooks WHERE workspace_id = ? AND person_id = ?').all(workspaceId, to)) as Array<{ id: string; name: string }>;
    const byName = new Map(toBooks.map((b) => [b.name.trim().toLowerCase(), b.id]));
    const shared = async (id: string) => Boolean(await t.prepare('SELECT 1 AS x FROM note_shares WHERE notebook_id = ? LIMIT 1').get(id));
    for (const book of fromBooks) {
      const target = byName.get(book.name.trim().toLowerCase());
      if (!target) continue;
      if ((await shared(book.id)) || (await shared(target))) {
        const name = `${book.name} (${leaverName})`.slice(0, 80);
        await t.prepare('UPDATE note_notebooks SET name = ? WHERE id = ?').run(name, book.id);
        continue;
      }
      await t.prepare('UPDATE notes SET notebook_id = ? WHERE notebook_id = ?').run(target, book.id);
      await t.prepare('DELETE FROM note_notebooks WHERE id = ?').run(book.id);
    }
    moved = (await t.prepare('UPDATE notes SET person_id = ? WHERE workspace_id = ? AND person_id = ?').run(to, workspaceId, from)).changes;
    for (const table of ['note_notebooks', 'note_templates', 'note_saved_searches', 'note_reminders']) {
      await t.prepare(`UPDATE ${table} SET person_id = ? WHERE workspace_id = ? AND person_id = ?`).run(to, workspaceId, from);
    }
    // El acceso se chequea contra owner_id: los compartidos siguen valiendo con la nueva dueña.
    await t.prepare('UPDATE note_shares SET owner_id = ? WHERE workspace_id = ? AND owner_id = ?').run(to, workspaceId, from);
    await t.prepare('DELETE FROM note_shares WHERE workspace_id = ? AND owner_id = ? AND person_id = ?').run(workspaceId, to, to);
    // Lo que tenía compartido o asignado quien se fue ya no le corresponde.
    await t.prepare('DELETE FROM note_shares WHERE workspace_id = ? AND person_id = ?').run(workspaceId, from);
    await t.prepare('UPDATE note_tasks SET assignee_id = NULL WHERE assignee_id = ? AND note_id IN (SELECT id FROM notes WHERE workspace_id = ?)').run(from, workspaceId);
    await t.prepare('UPDATE note_prefs SET email_token = NULL WHERE workspace_id = ? AND person_id = ?').run(workspaceId, from);
    await t
      .prepare('INSERT INTO note_admin_audit (id, workspace_id, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), workspaceId, actorId, 'transfer', JSON.stringify({ from, to, notes: moved }), new Date().toISOString());
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  } finally {
    tx.close();
  }
  if (to !== actorId) {
    await createNotification({
      userId: to,
      type: 'note_access',
      title: `You received ${moved} notes from ${leaverName}`,
      href: '/app/notes',
      sourceType: 'note',
      sourceId: from,
      meta: { noteKind: 'transfer', actorName: leaverName, count: String(moved) },
    }).catch(() => undefined);
  }
  return moved;
}
