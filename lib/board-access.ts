/**
 * Board — acceso por pizarra.
 *
 * Por defecto una pizarra es del workspace: cualquier miembro la ve y la
 * edita (como siempre). En modo 'restricted' solo la ven quien la creó, los
 * admins del workspace y las personas invitadas (board_members) con su rol
 * (ver o editar). Gestionar el acceso (modo, invitados, link de invitado) es
 * de quien la creó y de los admins.
 *
 * Aparte, el link de invitado (edit_token) deja editar la escena sin login:
 * lo resuelve lib/board-guest.ts y no pasa por acá.
 */
import { nanoid } from 'nanoid';
import { getDb } from './db';
import { roleAtLeast, type TeamRole } from './teams';
import { listBoardMembers, type BoardMember } from './board-comments';

export type BoardAccessMode = 'workspace' | 'restricted';
export type BoardMemberRole = 'view' | 'edit';
/** Acceso efectivo de una persona: gestionar > editar > ver. */
export type BoardAccessLevel = 'manage' | 'edit' | 'view';

const RANK: Record<BoardAccessLevel, number> = { view: 0, edit: 1, manage: 2 };

export function accessAtLeast(level: BoardAccessLevel | null, need: BoardAccessLevel): boolean {
  return level != null && RANK[level] >= RANK[need];
}

export function normalizeAccessMode(raw: unknown): BoardAccessMode {
  return raw === 'restricted' ? 'restricted' : 'workspace';
}

/** Quién abre la pizarra: el workspace activo y la persona real. */
export interface BoardViewer {
  workspaceId: string;
  personId: string;
  /** Owner o admin del workspace (gestiona el acceso de cualquier pizarra). */
  isAdmin: boolean;
}

/**
 * Viewer a partir del usuario de la sesión. Sin depender de lib/session (los
 * tests la reemplazan): el dueño del workspace (sin actingUser) es admin.
 */
export function boardViewer(user: { id: string; actingUser?: { id: string } | null; role?: TeamRole }): BoardViewer {
  const personId = user.actingUser?.id ?? user.id;
  const isAdmin = !user.actingUser || personId === user.id || roleAtLeast(user.role ?? 'member', 'admin');
  return { workspaceId: user.id, personId, isAdmin };
}

/** Regla pura: modo de la pizarra + quién es + su rol de invitado (si tiene). */
export function resolveBoardAccess(
  board: { access?: string | null; created_by: string | null },
  viewer: Pick<BoardViewer, 'personId' | 'isAdmin'>,
  memberRole: BoardMemberRole | null,
): BoardAccessLevel | null {
  if (viewer.isAdmin || (board.created_by != null && board.created_by === viewer.personId)) return 'manage';
  if (normalizeAccessMode(board.access) === 'workspace') return 'edit';
  if (memberRole === 'edit') return 'edit';
  if (memberRole === 'view') return 'view';
  return null;
}

/** Condición SQL para listar solo las pizarras que la persona puede ver (alias `b`). */
export function boardVisibleSql(viewer: BoardViewer): { sql: string; args: string[] } {
  if (viewer.isAdmin) return { sql: '1 = 1', args: [] };
  return {
    sql: `(b.access IS NULL OR b.access != 'restricted' OR b.created_by = ?
           OR EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND m.user_id = ?))`,
    args: [viewer.personId, viewer.personId],
  };
}

interface AccessRow {
  workspace_id: string;
  created_by: string | null;
  access: string | null;
}

/** Acceso de la persona a la pizarra del workspace activo (null = no existe o no la puede ver). */
export async function getBoardAccess(viewer: BoardViewer, boardId: string): Promise<BoardAccessLevel | null> {
  const row = (await getDb()
    .prepare('SELECT workspace_id, created_by, access FROM boards WHERE id = ? AND workspace_id = ?')
    .get(boardId, viewer.workspaceId)) as AccessRow | undefined;
  if (!row) return null;
  return resolveBoardAccess(row, viewer, await memberRole(boardId, viewer.personId));
}

async function memberRole(boardId: string, personId: string): Promise<BoardMemberRole | null> {
  const m = (await getDb()
    .prepare('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?')
    .get(boardId, personId)) as { role: string } | undefined;
  if (!m) return null;
  return m.role === 'view' ? 'view' : 'edit';
}

/**
 * ¿La persona puede ver la pizarra, mire desde el workspace que mire? (bloque
 * /board de Docs, avisos). Tiene que ser del workspace dueño de la pizarra.
 */
export async function personCanViewBoard(personId: string, boardId: string): Promise<boolean> {
  const row = (await getDb()
    .prepare('SELECT workspace_id, created_by, access FROM boards WHERE id = ?')
    .get(boardId)) as AccessRow | undefined;
  if (!row) return false;
  const members = await listBoardMembers(row.workspace_id);
  if (!members.some((m) => m.id === personId)) return false;
  const isAdmin = personId === row.workspace_id || (await isWorkspaceAdmin(row.workspace_id, personId));
  return resolveBoardAccess(row, { personId, isAdmin }, await memberRole(boardId, personId)) !== null;
}

async function isWorkspaceAdmin(workspaceId: string, personId: string): Promise<boolean> {
  const row = (await getDb()
    .prepare(
      `SELECT 1 AS x FROM team_members m JOIN teams t ON t.id = m.team_id
       WHERE t.owner_id = ? AND m.user_id = ? AND m.role IN ('owner', 'admin') LIMIT 1`,
    )
    .get(workspaceId, personId)) as { x: number } | undefined;
  return Boolean(row);
}

// ---------- Gestión ----------

export interface BoardAccessMember extends BoardMember {
  role: BoardMemberRole;
}

export interface BoardAccessInfo {
  mode: BoardAccessMode;
  created_by: string | null;
  members: BoardAccessMember[];
  /** Miembros del workspace (para invitar). */
  candidates: BoardMember[];
  guest_token: string | null;
}

export async function getBoardAccessInfo(workspaceId: string, boardId: string): Promise<BoardAccessInfo | null> {
  const row = (await getDb()
    .prepare('SELECT created_by, access, edit_token FROM boards WHERE id = ? AND workspace_id = ?')
    .get(boardId, workspaceId)) as { created_by: string | null; access: string | null; edit_token: string | null } | undefined;
  if (!row) return null;
  const candidates = await listBoardMembers(workspaceId);
  const roles = (await getDb()
    .prepare('SELECT user_id, role FROM board_members WHERE board_id = ? ORDER BY created_at')
    .all(boardId)) as Array<{ user_id: string; role: string }>;
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const members: BoardAccessMember[] = [];
  for (const r of roles) {
    const person = byId.get(r.user_id);
    // Quien ya no es del workspace no cuenta (y no se muestra).
    if (person) members.push({ ...person, role: r.role === 'view' ? 'view' : 'edit' });
  }
  return { mode: normalizeAccessMode(row.access), created_by: row.created_by, members, candidates, guest_token: row.edit_token };
}

export async function setBoardAccessMode(workspaceId: string, boardId: string, mode: BoardAccessMode): Promise<boolean> {
  const res = await getDb()
    .prepare('UPDATE boards SET access = ? WHERE id = ? AND workspace_id = ?')
    .run(mode, boardId, workspaceId);
  return res.changes > 0;
}

export type SetMemberResult = 'ok' | 'not_found' | 'not_member';

/** Invita (o cambia el rol de) una persona del workspace; role null la saca. */
export async function setBoardMember(
  workspaceId: string,
  boardId: string,
  userId: string,
  role: BoardMemberRole | null,
  addedBy: string,
): Promise<SetMemberResult> {
  const exists = await getDb().prepare('SELECT 1 AS x FROM boards WHERE id = ? AND workspace_id = ?').get(boardId, workspaceId);
  if (!exists) return 'not_found';
  if (role === null) {
    await getDb().prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?').run(boardId, userId);
    return 'ok';
  }
  const members = await listBoardMembers(workspaceId);
  if (!members.some((m) => m.id === userId)) return 'not_member';
  await getDb()
    .prepare(
      `INSERT INTO board_members (board_id, user_id, role, added_by, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(board_id, user_id) DO UPDATE SET role = excluded.role`,
    )
    .run(boardId, userId, role, addedBy, new Date().toISOString());
  return 'ok';
}

/** Prende/apaga el link de invitado con edición. Devuelve el token, null (apagado) o false (no existe). */
export async function setBoardGuestLink(workspaceId: string, boardId: string, on: boolean): Promise<string | null | false> {
  const row = (await getDb()
    .prepare('SELECT edit_token FROM boards WHERE id = ? AND workspace_id = ?')
    .get(boardId, workspaceId)) as { edit_token: string | null } | undefined;
  if (!row) return false;
  if (!on) {
    await getDb().prepare('UPDATE boards SET edit_token = NULL WHERE id = ? AND workspace_id = ?').run(boardId, workspaceId);
    return null;
  }
  if (row.edit_token) return row.edit_token;
  const token = nanoid(28);
  await getDb().prepare('UPDATE boards SET edit_token = ? WHERE id = ? AND workspace_id = ?').run(token, boardId, workspaceId);
  return token;
}

/** Personas del workspace que pueden ver la pizarra (menciones y avisos). */
export async function boardAudience(workspaceId: string, boardId: string): Promise<BoardMember[]> {
  const all = await listBoardMembers(workspaceId);
  const row = (await getDb()
    .prepare('SELECT workspace_id, created_by, access FROM boards WHERE id = ? AND workspace_id = ?')
    .get(boardId, workspaceId)) as AccessRow | undefined;
  if (!row) return [];
  if (normalizeAccessMode(row.access) === 'workspace') return all;
  const invited = new Set(
    ((await getDb().prepare('SELECT user_id FROM board_members WHERE board_id = ?').all(boardId)) as Array<{ user_id: string }>).map(
      (r) => r.user_id,
    ),
  );
  const out: BoardMember[] = [];
  for (const m of all) {
    if (m.id === row.created_by || m.id === workspaceId || invited.has(m.id) || (await isWorkspaceAdmin(workspaceId, m.id))) out.push(m);
  }
  return out;
}
