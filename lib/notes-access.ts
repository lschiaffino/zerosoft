/**
 * Notes: pedir acceso. Alguien del workspace abre el link de una nota que no
 * puede ver: no ve el título ni nada de adentro, solo puede pedir acceso. El
 * dueño recibe un aviso y lo aprueba (ver o editar) o lo rechaza desde
 * Compartir. Fuera del workspace la nota no existe. Server-only.
 */
import { getDb, getUserById } from './db';
import { createNotification } from './notifications';
import type { NoteOwner } from './notes';
import { resolveNoteAccess, setNoteShare, type NoteShareRole } from './notes-shares';
import { noteHref } from './notes-types';

/** Después de un rechazo se puede volver a pedir recién pasado este tiempo. */
export const ACCESS_RETRY_MS = 24 * 3_600_000;

/** denied: rechazado y ya se puede volver a pedir. denied_wait: todavía no. */
export type AccessGate = { status: 'can_request' | 'pending' | 'denied' | 'denied_wait' };

async function foreignNote(viewer: NoteOwner, noteId: string): Promise<{ person_id: string; title: string } | null> {
  const row = (await getDb().prepare('SELECT person_id, workspace_id, title, trashed_at FROM notes WHERE id = ?').get(noteId)) as
    | { person_id: string; workspace_id: string; title: string; trashed_at: string | null }
    | undefined;
  if (!row || row.workspace_id !== viewer.workspaceId || row.trashed_at || row.person_id === viewer.personId) return null;
  if (await resolveNoteAccess(viewer, noteId)) return null;
  return row;
}

/** Null: no aplica (la nota no existe, es de otro workspace o ya tiene acceso). */
export async function noteAccessGate(viewer: NoteOwner, noteId: string): Promise<AccessGate | null> {
  if (!(await foreignNote(viewer, noteId))) return null;
  const req = (await getDb().prepare('SELECT status, decided_at FROM note_access_requests WHERE note_id = ? AND requester_id = ?').get(noteId, viewer.personId)) as
    | { status: string; decided_at: string | null }
    | undefined;
  if (req?.status === 'pending') return { status: 'pending' };
  if (req?.status === 'denied') return { status: Date.now() - Date.parse(req.decided_at ?? '') < ACCESS_RETRY_MS ? 'denied_wait' : 'denied' };
  return { status: 'can_request' };
}

export async function requestNoteAccess(viewer: NoteOwner, noteId: string): Promise<boolean> {
  const note = await foreignNote(viewer, noteId);
  if (!note) return false;
  // Recién rechazado: no se vuelve a molestar al dueño.
  if ((await noteAccessGate(viewer, noteId))?.status === 'denied_wait') return true;
  const res = await getDb()
    .prepare(
      `INSERT INTO note_access_requests (id, note_id, requester_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)
       ON CONFLICT (note_id, requester_id) DO UPDATE SET status = 'pending', created_at = excluded.created_at, decided_at = NULL
       WHERE note_access_requests.status <> 'pending'`,
    )
    .run(crypto.randomUUID(), noteId, viewer.personId, new Date().toISOString());
  if (res.changes > 0) {
    const who = await getUserById(viewer.personId);
    await createNotification({
      userId: note.person_id,
      type: 'note_access',
      title: `${who?.name || who?.email || 'Someone'} requested access to a note`,
      body: note.title || undefined,
      href: `${noteHref(noteId)}&requests=1`,
      sourceType: 'note',
      sourceId: noteId,
    }).catch(() => undefined);
  }
  return true;
}

export interface NoteAccessRequest {
  id: string;
  person_id: string;
  name: string | null;
  email: string;
  created_at: string;
}

export async function listAccessRequests(owner: NoteOwner, noteId: string): Promise<NoteAccessRequest[] | null> {
  const access = await resolveNoteAccess(owner, noteId);
  if (!access || access.access !== 'owner') return null;
  return (await getDb()
    .prepare(
      `SELECT r.id, r.requester_id AS person_id, u.name, u.email, r.created_at FROM note_access_requests r
       JOIN users u ON u.id = r.requester_id WHERE r.note_id = ? AND r.status = 'pending' ORDER BY r.created_at`,
    )
    .all(noteId)) as NoteAccessRequest[];
}

/** Aprueba con un rol o rechaza (role null). Claim con compare-and-set del estado. */
export async function decideAccessRequest(owner: NoteOwner, noteId: string, requestId: string, role: NoteShareRole | null): Promise<'ok' | 'not_found' | 'not_member'> {
  const access = await resolveNoteAccess(owner, noteId);
  if (!access || access.access !== 'owner') return 'not_found';
  const db = getDb();
  const row = (await db.prepare("SELECT requester_id FROM note_access_requests WHERE id = ? AND note_id = ? AND status = 'pending'").get(requestId, noteId)) as { requester_id: string } | undefined;
  if (!row) return 'not_found';
  const claim = await db
    .prepare("UPDATE note_access_requests SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
    .run(role ? 'approved' : 'denied', new Date().toISOString(), requestId);
  if (claim.changes === 0) return 'not_found';
  if (role) {
    // setNoteShare ya avisa a la persona que recibe la nota.
    const res = await setNoteShare(owner, { kind: 'note', id: noteId }, row.requester_id, role);
    if (res === 'not_member' || res === 'not_found') return res;
  }
  return 'ok';
}
