import {
  getDb,
  type TeamInviteRow,
  type TeamMemberRow,
  type TeamRow,
  type UserRow,
} from './db';

/**
 * Teams: el workspace de un owner compartido con invitados.
 * Modelo simple: los datos del CRM viven bajo el user_id del owner;
 * un member con active_team_id apuntando al team opera "como" el owner
 * (ver lib/session.ts → getCurrentUser).
 */

const INVITE_TTL_DAYS = 14;

// ---------- Roles ----------

/** owner: dueño del team. admin: gestiona miembros y configuración. member: usa las apps. */
export type TeamRole = 'owner' | 'admin' | 'member';
const ROLE_RANK: Record<TeamRole, number> = { member: 0, admin: 1, owner: 2 };

export function normalizeRole(role: string | null | undefined): TeamRole {
  return role === 'owner' || role === 'admin' ? role : 'member';
}

export function roleAtLeast(role: TeamRole, min: TeamRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export async function getMemberRole(teamId: string, userId: string): Promise<TeamRole | null> {
  const team = await getTeamById(teamId);
  if (!team) return null;
  if (team.owner_id === userId) return 'owner';
  const row = (await getDb()
    .prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?')
    .get(teamId, userId)) as { role: string } | undefined;
  return row ? normalizeRole(row.role) : null;
}

/** Cambia el rol de un member (nunca al owner, ni a 'owner'). */
export async function setMemberRole(teamId: string, userId: string, role: 'admin' | 'member'): Promise<boolean> {
  const res = await getDb()
    .prepare("UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ? AND role != 'owner'")
    .run(role, teamId, userId);
  if (res.changes > 0) await boardAccessChanged(teamId);
  return res.changes > 0;
}

/**
 * Aviso a las conexiones en vivo de Board del workspace (board_id '*'): cada
 * una revalida su acceso ya, así quien salió del team o perdió el rol deja de
 * recibir al instante. Directo a la tabla para no importar Board desde acá.
 */
async function boardAccessChanged(teamId: string): Promise<void> {
  try {
    const team = await getTeamById(teamId);
    if (!team) return;
    await getDb()
      .prepare("INSERT INTO board_events (board_id, workspace_id, socket_id, kind, payload, created_at) VALUES ('*', ?, 'server', 'access', '{}', ?)")
      .run(team.owner_id, new Date().toISOString());
  } catch {
    /* sin Board: nada que avisar */
  }
}

export async function getTeamById(id: string): Promise<TeamRow | null> {
  const row = (await getDb().prepare('SELECT * FROM teams WHERE id = ?').get(id)) as
    | TeamRow
    | undefined;
  return row ?? null;
}

/** Teams que posee un usuario (MVP: 0 o 1 en la práctica, pero soporta N). */
export async function listOwnedTeams(userId: string): Promise<TeamRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM teams WHERE owner_id = ? ORDER BY created_at ASC')
    .all(userId)) as TeamRow[];
}

/** Teams donde el usuario es member (no owner). */
export async function listMemberTeams(userId: string): Promise<Array<TeamRow & { owner_email: string }>> {
  return (await getDb()
    .prepare(
      `SELECT t.*, u.email AS owner_email
       FROM teams t
       JOIN team_members m ON m.team_id = t.id
       JOIN users u ON u.id = t.owner_id
       WHERE m.user_id = ? AND t.owner_id != ?
       ORDER BY t.created_at ASC`,
    )
    .all(userId, userId)) as Array<TeamRow & { owner_email: string }>;
}

export async function createTeam(ownerId: string, name: string): Promise<TeamRow> {
  const id = crypto.randomUUID();
  const trimmed = name.trim().slice(0, 80) || 'My team';
  await getDb().prepare('INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)').run(
    id,
    trimmed,
    ownerId,
  );
  await getDb()
    .prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner')")
    .run(id, ownerId);
  return (await getTeamById(id))!;
}

export async function isMember(teamId: string, userId: string): Promise<boolean> {
  const row = await getDb()
    .prepare('SELECT 1 AS x FROM team_members WHERE team_id = ? AND user_id = ?')
    .get(teamId, userId);
  return row !== undefined;
}

export interface TeamMemberInfo {
  user_id: string;
  role: string;
  email: string;
  name: string | null;
  created_at: string;
}

export async function listMembers(teamId: string): Promise<TeamMemberInfo[]> {
  return (await getDb()
    .prepare(
      `SELECT m.user_id, m.role, m.created_at, u.email, u.name
       FROM team_members m JOIN users u ON u.id = m.user_id
       WHERE m.team_id = ?
       ORDER BY m.role = 'owner' DESC, m.created_at ASC`,
    )
    .all(teamId)) as TeamMemberInfo[];
}

export async function addMember(teamId: string, userId: string, role = 'member'): Promise<void> {
  await getDb()
    .prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)')
    .run(teamId, userId, role);
  // Migración del CRM: los registros que esperaban a esta persona (owner del otro CRM) pasan a ser suyos.
  const team = await getTeamById(teamId);
  if (team) {
    const { claimImportedRecords } = await import('./crm-import-owners');
    await claimImportedRecords(team.owner_id, userId).catch(() => undefined);
  }
}

export async function removeMember(teamId: string, userId: string): Promise<void> {
  const team = await getTeamById(teamId);
  await getDb()
    .prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ? AND role != 'owner'")
    .run(teamId, userId);
  await boardAccessChanged(teamId);
  // Las API keys que creó en el workspace del owner dejan de funcionar.
  if (team) {
    await getDb()
      .prepare('UPDATE api_keys SET revoked = 1 WHERE user_id = ? AND created_by = ?')
      .run(team.owner_id, userId);
    // Deja de ser host de los tipos de evento del workspace (no recibe más
    // reservas ni expone su disponibilidad).
    await getDb()
      .prepare(
        `DELETE FROM calendar_event_hosts WHERE user_id = ? AND event_type_id IN (
           SELECT id FROM calendar_event_types WHERE user_id = ?)`,
      )
      .run(userId, team.owner_id);
    // Sus reservas por venir pasan a otro host (o al owner), con aviso.
    const { reassignRemovedHostBookings } = await import('./calendar-lifecycle');
    await reassignRemovedHostBookings(team.owner_id, userId);
  }
  // Sus conversaciones de Chat del team quedan sin asignar: no le llegan más
  // los mensajes de los visitantes y las reglas las vuelven a repartir.
  await getDb()
    .prepare(
      `UPDATE chat_conversations SET assigned_to = NULL
       WHERE assigned_to = ? AND widget_id IN (SELECT id FROM chat_widgets WHERE team_id = ?)`,
    )
    .run(userId, teamId);
  // Talk: deja los canales, sin avisos ni emails pendientes, sus DMs quedan desactivados.
  if (team) {
    const { talkPersonRemoved } = await import('./talk');
    await talkPersonRemoved(team.owner_id, userId).catch((err) => console.error('[teams] talk cleanup', err));
  }
  // Si el usuario tenía este team como activo, vuelve a su workspace personal.
  await getDb()
    .prepare('UPDATE users SET active_team_id = NULL WHERE id = ? AND active_team_id = ?')
    .run(userId, teamId);
}

// ---------- Invites ----------

export async function createInvite(
  teamId: string,
  email: string,
  invitedBy: string,
): Promise<TeamInviteRow> {
  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replace(/-/g, '');
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();
  await getDb()
    .prepare(
      `INSERT INTO team_invites (id, team_id, email, token, invited_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, teamId, email.trim().toLowerCase().slice(0, 254), token, invitedBy, expires);
  return (await getDb().prepare('SELECT * FROM team_invites WHERE id = ?').get(id)) as TeamInviteRow;
}

export async function listPendingInvites(teamId: string): Promise<TeamInviteRow[]> {
  return (await getDb()
    .prepare(
      `SELECT * FROM team_invites
       WHERE team_id = ? AND status = 'pending'
       ORDER BY created_at DESC`,
    )
    .all(teamId)) as TeamInviteRow[];
}

export async function getInviteByToken(token: string): Promise<TeamInviteRow | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM team_invites WHERE token = ?')
    .get(token)) as TeamInviteRow | undefined;
  return row ?? null;
}

export function inviteUsable(invite: TeamInviteRow): boolean {
  if (invite.status !== 'pending') return false;
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) return false;
  return true;
}

/** Acepta una invite: suma al user al team y marca la invite. Devuelve el team. */
export async function acceptInvite(
  invite: TeamInviteRow,
  userId: string,
): Promise<TeamRow | null> {
  if (!inviteUsable(invite)) return null;
  await addMember(invite.team_id, userId, invite.role === 'owner' ? 'member' : invite.role);
  await getDb()
    .prepare("UPDATE team_invites SET status = 'accepted' WHERE id = ?")
    .run(invite.id);
  return getTeamById(invite.team_id);
}

export async function revokeInvite(inviteId: string, teamId: string): Promise<void> {
  await getDb()
    .prepare("UPDATE team_invites SET status = 'revoked' WHERE id = ? AND team_id = ?")
    .run(inviteId, teamId);
}

// ---------- Workspace activo ----------

export async function setActiveTeam(userId: string, teamId: string | null): Promise<boolean> {
  if (teamId !== null && !(await isMember(teamId, userId))) return false;
  await getDb()
    .prepare('UPDATE users SET active_team_id = ? WHERE id = ?')
    .run(teamId, userId);
  return true;
}

/**
 * Resuelve el workspace efectivo del usuario: si tiene active_team_id y sigue
 * siendo member, devuelve el owner del team (los datos viven bajo su id).
 * Si el team ya no existe o fue removido, limpia la preferencia.
 */
export async function resolveWorkspace(
  user: UserRow,
): Promise<{ owner: UserRow; team: TeamRow | null; role: TeamRole }> {
  if (!user.active_team_id) return { owner: user, team: null, role: 'owner' };
  const team = await getTeamById(user.active_team_id);
  if (!team || !(await isMember(team.id, user.id))) {
    await getDb()
      .prepare('UPDATE users SET active_team_id = NULL WHERE id = ?')
      .run(user.id);
    return { owner: user, team: null, role: 'owner' };
  }
  if (team.owner_id === user.id) return { owner: user, team, role: 'owner' };
  const owner = (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(team.owner_id)) as
    | UserRow
    | undefined;
  if (!owner) return { owner: user, team: null, role: 'owner' };
  return { owner, team, role: (await getMemberRole(team.id, user.id)) ?? 'member' };
}
