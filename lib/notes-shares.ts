/**
 * Notes — compartir una nota o una libreta con compañeros del workspace.
 *
 * Las notas siguen siendo de la persona (lib/notes.ts). Un share le da a otra
 * persona del mismo workspace acceso de lectura ('view') o de edición
 * ('edit') a una nota, o a todas las notas de una libreta (las de hoy y las
 * que se sumen). Quien recibe:
 * - la ve en "Compartidas conmigo" (nunca en sus propias listas ni en ⌘K);
 * - con 'edit' cambia título y contenido (no libreta, tags, fijado, papelera,
 *   recordatorio ni link público, que son del dueño);
 * - no ve los títulos de las otras notas del dueño: los links [[ ]] quedan
 *   como texto y no hay "Enlazada desde".
 * Una nota en la papelera deja de verse para quien la recibió.
 */
import { getDb, getUserById, type NoteRow } from './db';
import { listBoardMembers } from './board-comments';
import { resolveBlocksPageLinks } from './docs-page-links';
import type { DocsBlock } from './docs-types';
import { createNotification } from './notifications';
import { getNote, type NoteOwner } from './notes';
import { makeSnippet, noteHref, searchTerms, type NoteDetail, type NoteSummary } from './notes-types';

export type NoteShareRole = 'view' | 'edit';
export type NoteAccess = 'owner' | NoteShareRole;
export type NoteShareTarget = { kind: 'note'; id: string } | { kind: 'notebook'; id: string };

export interface NoteShareInfo {
  person_id: string;
  name: string | null;
  email: string;
  role: NoteShareRole;
}

/** El rol más fuerte entre varios shares (nota + libreta). Puro. */
export function strongestRole(roles: ReadonlyArray<string | null | undefined>): NoteShareRole | null {
  if (roles.includes('edit')) return 'edit';
  if (roles.includes('view')) return 'view';
  return null;
}

/** Campos que puede cambiar quien recibió la nota con rol 'edit'. Puro. */
export const SHARED_EDIT_FIELDS = ['title', 'content', 'base_updated_at'] as const;

export function sharedPatchAllowed(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).every((k) => patch[k] === undefined || (SHARED_EDIT_FIELDS as readonly string[]).includes(k));
}

async function targetOwned(owner: NoteOwner, target: NoteShareTarget): Promise<boolean> {
  const table = target.kind === 'note' ? 'notes' : 'note_notebooks';
  const row = await getDb()
    .prepare(`SELECT 1 AS x FROM ${table} WHERE id = ? AND workspace_id = ? AND person_id = ?`)
    .get(target.id, owner.workspaceId, owner.personId);
  return Boolean(row);
}

export async function listNoteShares(owner: NoteOwner, target: NoteShareTarget): Promise<NoteShareInfo[] | null> {
  if (!(await targetOwned(owner, target))) return null;
  const col = target.kind === 'note' ? 'note_id' : 'notebook_id';
  const rows = (await getDb()
    .prepare(
      `SELECT s.person_id, s.role, u.name, u.email FROM note_shares s JOIN users u ON u.id = s.person_id
       WHERE s.${col} = ? AND s.owner_id = ? AND s.workspace_id = ? ORDER BY s.created_at`,
    )
    .all(target.id, owner.personId, owner.workspaceId)) as Array<{ person_id: string; role: string; name: string | null; email: string }>;
  return rows.map((r) => ({ person_id: r.person_id, name: r.name, email: r.email, role: r.role === 'edit' ? 'edit' : 'view' }));
}

/** Personas del workspace con las que se puede compartir (todas menos el dueño). */
export async function noteShareCandidates(owner: NoteOwner): Promise<Array<{ id: string; name: string | null; email: string }>> {
  return (await listBoardMembers(owner.workspaceId)).filter((m) => m.id !== owner.personId);
}

export type SetNoteShareResult = 'ok' | 'not_found' | 'not_member';

/** Comparte (o cambia el rol, o deja de compartir con role null) con una persona del workspace. */
export async function setNoteShare(
  owner: NoteOwner,
  target: NoteShareTarget,
  personId: string,
  role: NoteShareRole | null,
): Promise<SetNoteShareResult> {
  if (!(await targetOwned(owner, target))) return 'not_found';
  const col = target.kind === 'note' ? 'note_id' : 'notebook_id';
  const db = getDb();
  if (role === null) {
    await db
      .prepare(`DELETE FROM note_shares WHERE ${col} = ? AND person_id = ? AND owner_id = ?`)
      .run(target.id, personId, owner.personId);
    return 'ok';
  }
  if (personId === owner.personId) return 'not_member';
  const members = await listBoardMembers(owner.workspaceId);
  if (!members.some((m) => m.id === personId)) return 'not_member';
  const existing = (await db
    .prepare(`SELECT id FROM note_shares WHERE ${col} = ? AND person_id = ?`)
    .get(target.id, personId)) as { id: string } | undefined;
  if (existing) {
    await db.prepare('UPDATE note_shares SET role = ? WHERE id = ?').run(role, existing.id);
    return 'ok';
  }
  await db
    .prepare(
      `INSERT INTO note_shares (id, workspace_id, owner_id, note_id, notebook_id, person_id, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      owner.workspaceId,
      owner.personId,
      target.kind === 'note' ? target.id : null,
      target.kind === 'notebook' ? target.id : null,
      personId,
      role,
      new Date().toISOString(),
    );
  await notifyShare(owner, target, personId).catch(() => {});
  return 'ok';
}

async function notifyShare(owner: NoteOwner, target: NoteShareTarget, personId: string): Promise<void> {
  const actor = await getUserById(owner.personId);
  const actorName = actor?.name ?? actor?.email ?? 'Someone';
  const table = target.kind === 'note' ? 'notes' : 'note_notebooks';
  const col = target.kind === 'note' ? 'title' : 'name';
  const row = (await getDb().prepare(`SELECT ${col} AS label FROM ${table} WHERE id = ?`).get(target.id)) as
    | { label: string }
    | undefined;
  const label = row?.label || 'Untitled';
  await createNotification({
    userId: personId,
    type: 'comment',
    title: `${actorName} shared ${label} with you`,
    href: target.kind === 'note' ? noteHref(target.id) : '/app/notes?view=shared',
    sourceType: target.kind === 'note' ? 'note' : 'note_notebook',
    sourceId: target.id,
    meta: { actorName, actorId: owner.personId, shared: true, title: label },
  });
}

// ---------- Acceso de quien recibe ----------

/** Rol de `viewer` sobre la nota de otra persona (null = sin acceso). */
async function sharedRole(viewer: NoteOwner, row: NoteRow): Promise<NoteShareRole | null> {
  if (row.workspace_id !== viewer.workspaceId || row.trashed_at) return null;
  const rows = (await getDb()
    .prepare(
      `SELECT role FROM note_shares
       WHERE person_id = ? AND owner_id = ? AND (note_id = ? OR (notebook_id IS NOT NULL AND notebook_id = ?))`,
    )
    .all(viewer.personId, row.person_id, row.id, row.notebook_id ?? '')) as Array<{ role: string }>;
  return strongestRole(rows.map((r) => r.role));
}

/**
 * Acceso a una nota: 'owner' si es propia; si no, el rol del share. Devuelve
 * también el dueño (para operar con las funciones de lib/notes.ts).
 */
export async function resolveNoteAccess(
  viewer: NoteOwner,
  id: string,
): Promise<{ access: NoteAccess; owner: NoteOwner; row: NoteRow } | null> {
  const row = (await getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id)) as NoteRow | undefined;
  if (!row || row.workspace_id !== viewer.workspaceId) return null;
  const owner = { workspaceId: row.workspace_id, personId: row.person_id };
  if (row.person_id === viewer.personId) return { access: 'owner', owner, row };
  const role = await sharedRole(viewer, row);
  return role ? { access: role, owner, row } : null;
}

/** Nota compartida vista por quien la recibió: sin links a otras notas del dueño ni datos suyos. */
export async function getNoteForViewer(viewer: NoteOwner, id: string): Promise<NoteDetail | null> {
  const res = await resolveNoteAccess(viewer, id);
  if (!res) return null;
  if (res.access === 'owner') {
    const note = await getNote(viewer, id);
    return note ? { ...note, access: 'owner' } : null;
  }
  const note = await getNote(res.owner, id);
  if (!note) return null;
  const owner = await getUserById(res.owner.personId);
  // Del contenido guardado (getNote ya reemplazó los links por el título actual de cada nota).
  let raw: DocsBlock[] = [];
  try {
    raw = JSON.parse(res.row.content || '[]') as DocsBlock[];
  } catch {
    raw = [];
  }
  return {
    ...note,
    content: resolveBlocksPageLinks(raw, () => null),
    backlinks: [],
    reminder: null,
    share_token: null,
    shared: false,
    notebook_id: null,
    pinned: false,
    access: res.access,
    owner_name: owner?.name ?? owner?.email ?? null,
  };
}

/** "Compartidas conmigo": notas de otras personas del workspace (directas o por libreta), sin papelera. */
export async function listSharedWithMe(viewer: NoteOwner, opts: { q?: string | null; limit?: number } = {}): Promise<NoteSummary[]> {
  const limit = opts.limit ?? 300;
  const rows = (await getDb()
    .prepare(
      `SELECT n.*, u.name AS owner_name, u.email AS owner_email,
              MAX(CASE s.role WHEN 'edit' THEN 1 ELSE 0 END) AS can_edit
       FROM note_shares s
       JOIN notes n ON (n.id = s.note_id OR (s.notebook_id IS NOT NULL AND n.notebook_id = s.notebook_id))
       JOIN users u ON u.id = n.person_id
       WHERE s.person_id = ? AND s.workspace_id = ? AND n.workspace_id = s.workspace_id
         AND n.person_id = s.owner_id AND n.trashed_at IS NULL
       GROUP BY n.id
       ORDER BY n.updated_at DESC
       LIMIT ${Math.min(Math.max(limit, 1), 1000)}`,
    )
    .all(viewer.personId, viewer.workspaceId)) as Array<NoteRow & { owner_name: string | null; owner_email: string; can_edit: number }>;
  // Búsqueda simple por palabras (título o texto), todas requeridas.
  const terms = searchTerms(opts.q ?? '');
  const matching = terms.length
    ? rows.filter((r) => {
        const hay = `${r.title}\n${r.body_text}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
    : rows;
  return matching.map((r) => ({
    id: r.id,
    notebook_id: null,
    title: r.title,
    snippet: makeSnippet(r.body_text),
    tags: [],
    pinned: false,
    trashed: false,
    source_url: r.source_url,
    shared: false,
    created_at: r.created_at,
    updated_at: r.updated_at,
    shared_by: r.owner_name ?? r.owner_email,
    access: Number(r.can_edit) === 1 ? 'edit' : 'view',
  }));
}
