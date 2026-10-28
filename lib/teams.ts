import { getDb, type TeamInviteRow, type TeamRow, type UserRow } from './db';
import { ensureWorkspace, getMembership, parseApps, serializeApps, teamKeyed, type AppAccess } from './workspace';

/**
 * Teams: el workspace de un owner compartido con su gente (ver lib/workspace.ts).
 * Los datos viven bajo el user_id del owner; un miembro con active_team_id
 * apuntando al equipo opera "como" el owner (lib/session.ts → getCurrentUser).
 */

export const INVITE_TTL_DAYS = 14;

// ---------- Roles ----------

/**
 * owner: dueño del workspace. admin: gestiona miembros y configuración.
 * member: usa las apps. guest: solo lo que le comparten (no entra al workspace).
 */
export type TeamRole = 'owner' | 'admin' | 'member' | 'guest';
const ROLE_RANK: Record<TeamRole, number> = { guest: -1, member: 0, admin: 1, owner: 2 };

export function normalizeRole(role: string | null | undefined): TeamRole {
  return role === 'owner' || role === 'admin' || role === 'guest' ? role : 'member';
}

export function roleAtLeast(role: TeamRole, min: TeamRole): boolean {
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK[min];
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

/** Cambia el rol de una persona (nunca al owner, ni a 'owner'). */
export async function setMemberRole(teamId: string, userId: string, role: 'admin' | 'member' | 'guest'): Promise<boolean> {
  const res = await getDb()
    .prepare("UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ? AND role != 'owner'")
    .run(role, teamId, userId);
  if (res.changes > 0 && role === 'guest') {
    // Pasar a guest saca a la persona del workspace: mismas limpiezas que al sacarla.
    const team = await getTeamById(teamId);
    if (team) {
      const { personRemoved } = await import('./workspace-lifecycle');
      await personRemoved({ ownerId: team.owner_id, teamId, userId, keepShares: true });
    }
  }
  return res.changes > 0;
}

/** Acceso por app de una persona ('*' o lista). */
export async function setMemberApps(teamId: string, userId: string, apps: AppAccess | readonly string[]): Promise<boolean> {
  const res = await getDb()
    .prepare("UPDATE team_members SET apps = ? WHERE team_id = ? AND user_id = ? AND role != 'owner'")
    .run(serializeApps(apps), teamId, userId);
  return res.changes > 0;
}

export async function getTeamById(id: string): Promise<TeamRow | null> {
  const row = (await getDb().prepare('SELECT * FROM teams WHERE id = ?').get(id)) as TeamRow | undefined;
  return row ?? null;
}

/** Teams que posee un usuario (el más viejo es la ficha del workspace). */
export async function listOwnedTeams(userId: string): Promise<TeamRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM teams WHERE owner_id = ? ORDER BY created_at ASC, id ASC')
    .all(userId)) as TeamRow[];
}

/** Teams donde el usuario es member (no owner, no guest). */
export async function listMemberTeams(userId: string): Promise<Array<TeamRow & { owner_email: string }>> {
  return (await getDb()
    .prepare(
      `SELECT t.*, u.email AS owner_email
       FROM teams t
       JOIN team_members m ON m.team_id = t.id
       JOIN users u ON u.id = t.owner_id
       WHERE m.user_id = ? AND t.owner_id != ? AND m.role != 'guest'
       ORDER BY t.created_at ASC`,
    )
    .all(userId, userId)) as Array<TeamRow & { owner_email: string }>;
}

/**
 * Crea un equipo aparte del owner (como antes de 128: sus datos de Track y
 * Chat cuelgan de su id). La app ya no lo usa para "crear un equipo": eso es
 * poner la ficha en modo equipo (lib/workspace.ts → updateWorkspace).
 */
export async function createTeam(ownerId: string, name: string): Promise<TeamRow> {
  const id = crypto.randomUUID();
  const trimmed = name.trim().slice(0, 80) || 'My team';
  await getDb()
    .prepare("INSERT INTO teams (id, name, owner_id, keyed_by, use_mode) VALUES (?, ?, ?, 'team', 'team')")
    .run(id, trimmed, ownerId);
  await getDb()
    .prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner')")
    .run(id, ownerId);
  return (await getTeamById(id))!;
}

/** ¿Es parte del equipo? (cualquier rol, guest incluido). */
export async function isMember(teamId: string, userId: string): Promise<boolean> {
  const row = await getDb().prepare('SELECT 1 AS x FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, userId);
  return row !== undefined;
}

/** ¿Es persona del equipo con acceso al workspace (owner, admin o member; no guest)? */
export async function isActiveMember(teamId: string, userId: string): Promise<boolean> {
  const row = await getDb()
    .prepare("SELECT 1 AS x FROM team_members WHERE team_id = ? AND user_id = ? AND role != 'guest'")
    .get(teamId, userId);
  if (row) return true;
  return Boolean(await getDb().prepare('SELECT 1 AS x FROM teams WHERE id = ? AND owner_id = ?').get(teamId, userId));
}

export interface TeamMemberInfo {
  user_id: string;
  role: string;
  email: string;
  name: string | null;
  created_at: string;
}

/** Personas del equipo (sin guests salvo que se pidan): pickers de asignación, menciones, hosts. */
export async function listMembers(teamId: string, opts: { includeGuests?: boolean } = {}): Promise<TeamMemberInfo[]> {
  return (await getDb()
    .prepare(
      `SELECT m.user_id, m.role, m.created_at, u.email, u.name
       FROM team_members m JOIN users u ON u.id = m.user_id
       WHERE m.team_id = ? ${opts.includeGuests ? '' : "AND m.role != 'guest'"}
       ORDER BY m.role = 'owner' DESC, m.created_at ASC`,
    )
    .all(teamId)) as TeamMemberInfo[];
}

export async function addMember(
  teamId: string,
  userId: string,
  role = 'member',
  opts: { apps?: AppAccess | readonly string[]; invitedBy?: string | null } = {},
): Promise<void> {
  const res = await getDb()
    .prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, role, apps, invited_by) VALUES (?, ?, ?, ?, ?)')
    .run(teamId, userId, role, serializeApps(opts.apps ?? '*'), opts.invitedBy ?? null);
  if (res.changes === 0) return;
  // Hook "persona se unió" (lib/workspace-lifecycle.ts): cada app engancha lo suyo ahí.
  const team = await getTeamById(teamId);
  if (team && team.owner_id !== userId) {
    const { personJoined } = await import('./workspace-lifecycle');
    await personJoined({ ownerId: team.owner_id, teamId, userId, role });
  }
}

/**
 * Saca a una persona del equipo y le corta el acceso en todas las apps (ver
 * lib/workspace-lifecycle.ts). El owner no se puede sacar.
 */
export async function removeMember(teamId: string, userId: string): Promise<void> {
  const team = await getTeamById(teamId);
  if (!team || team.owner_id === userId) return;
  await getDb().prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ? AND role != 'owner'").run(teamId, userId);
  const { personRemoved } = await import('./workspace-lifecycle');
  await personRemoved({ ownerId: team.owner_id, teamId, userId });
}

// ---------- Invites ----------

export type InviteRole = 'admin' | 'member' | 'guest';

export function normalizeInviteRole(role: unknown): InviteRole {
  return role === 'admin' || role === 'guest' ? role : 'member';
}

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/**
 * Crea una invitación por email. Si ya hay una pendiente y vigente para ese
 * email en el equipo, la actualiza (rol, apps, equipos) y devuelve esa: un
 * solo link vivo por persona.
 */
export async function createInvite(
  teamId: string,
  email: string,
  invitedBy: string,
  opts: { role?: InviteRole; apps?: AppAccess | readonly string[]; groupIds?: string[]; locale?: string } = {},
): Promise<TeamInviteRow> {
  const db = getDb();
  const clean = email.trim().toLowerCase().slice(0, 254);
  const role = normalizeInviteRole(opts.role);
  const apps = serializeApps(opts.apps ?? '*');
  const groups = JSON.stringify([...new Set((opts.groupIds ?? []).filter((g) => typeof g === 'string'))].slice(0, 50));
  const locale = opts.locale === 'es' || opts.locale === 'pt' ? opts.locale : 'en';
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();
  const pending = (await db
    .prepare("SELECT * FROM team_invites WHERE team_id = ? AND email = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1")
    .get(teamId, clean)) as TeamInviteRow | undefined;
  if (pending && inviteUsable(pending)) {
    await db
      .prepare('UPDATE team_invites SET role = ?, apps = ?, group_ids = ?, locale = ?, invited_by = ?, expires_at = ? WHERE id = ?')
      .run(role, apps, groups, locale, invitedBy, expires, pending.id);
    return (await db.prepare('SELECT * FROM team_invites WHERE id = ?').get(pending.id)) as TeamInviteRow;
  }
  if (pending) await db.prepare("UPDATE team_invites SET status = 'revoked' WHERE id = ?").run(pending.id);
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO team_invites (id, team_id, email, token, role, invited_by, expires_at, apps, group_ids, locale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, teamId, clean, newToken(), role, invitedBy, expires, apps, groups, locale);
  return (await db.prepare('SELECT * FROM team_invites WHERE id = ?').get(id)) as TeamInviteRow;
}

export async function getInvite(inviteId: string, teamId: string): Promise<TeamInviteRow | null> {
  const row = (await getDb().prepare('SELECT * FROM team_invites WHERE id = ? AND team_id = ?').get(inviteId, teamId)) as
    | TeamInviteRow
    | undefined;
  return row ?? null;
}

/** Registra el resultado de mandar el email de la invitación. */
export async function markInviteSent(inviteId: string, result: { ok: boolean; error?: string; skipped?: boolean }): Promise<void> {
  await getDb()
    .prepare('UPDATE team_invites SET send_count = send_count + ?, last_sent_at = ?, email_status = ?, email_error = ? WHERE id = ?')
    .run(
      result.skipped ? 0 : 1,
      new Date().toISOString(),
      result.skipped ? 'skipped' : result.ok ? 'sent' : 'failed',
      result.ok ? '' : String(result.error ?? '').slice(0, 200),
      inviteId,
    );
}

/**
 * Manda (o reenvía) el email de una invitación ya creada y registra cómo
 * salió. La usan Ajustes › Miembros (vía lib/workspace-invites.ts) y otros
 * flujos que invitan gente (p. ej. el importador de HubSpot a los owners que
 * todavía no son miembros). `invitedBy`: id de quien invita o sus datos.
 */
export async function sendInviteEmail(
  invite: TeamInviteRow,
  opts: { url: string; locale?: string; invitedBy?: string | { id?: string; name?: string | null; email?: string | null } | null },
): Promise<{ status: 'sent' | 'failed' | 'skipped'; error?: string }> {
  const team = await getTeamById(invite.team_id);
  if (!team) return { status: 'failed', error: 'team_not_found' };
  const by = opts.invitedBy ?? invite.invited_by;
  const inviter =
    typeof by === 'string'
      ? ((await getDb().prepare('SELECT name, email FROM users WHERE id = ?').get(by)) as { name: string | null; email: string } | undefined)
      : by
        ? { name: by.name ?? null, email: by.email ?? '' }
        : undefined;
  const { sendInviteEmail: deliver } = await import('./invite-email');
  const res = await deliver({
    to: invite.email,
    url: opts.url,
    workspaceName: team.name,
    inviterName: inviter?.name?.trim() || inviter?.email?.split('@')[0] || team.name,
    inviterEmail: inviter?.email || null,
    role: normalizeInviteRole(invite.role),
    expiresAt: invite.expires_at,
    locale: opts.locale ?? invite.locale,
    logoUrl: team.logo_url ?? null,
  }).catch((err: unknown) => ({ status: 'failed' as const, error: err instanceof Error ? err.message : 'send_failed' }));
  await markInviteSent(invite.id, { ok: res.status === 'sent', skipped: res.status === 'skipped', error: res.error });
  return res;
}

export async function listPendingInvites(teamId: string): Promise<TeamInviteRow[]> {
  return (await getDb()
    .prepare("SELECT * FROM team_invites WHERE team_id = ? AND status = 'pending' ORDER BY created_at DESC")
    .all(teamId)) as TeamInviteRow[];
}

/** Invitaciones pendientes y vigentes para un email (en cualquier workspace). */
export async function listInvitesForEmail(
  email: string,
): Promise<Array<TeamInviteRow & { team_name: string; inviter_name: string | null; inviter_email: string | null }>> {
  const rows = (await getDb()
    .prepare(
      `SELECT i.*, t.name AS team_name, u.name AS inviter_name, u.email AS inviter_email FROM team_invites i
       JOIN teams t ON t.id = i.team_id LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.email = ? AND i.status = 'pending'
       ORDER BY i.created_at DESC LIMIT 10`,
    )
    .all(email.trim().toLowerCase())) as Array<TeamInviteRow & { team_name: string; inviter_name: string | null; inviter_email: string | null }>;
  return rows.filter(inviteUsable);
}

export async function getInviteByToken(token: string): Promise<TeamInviteRow | null> {
  if (!token || token.length > 128) return null;
  const row = (await getDb().prepare('SELECT * FROM team_invites WHERE token = ?').get(token)) as TeamInviteRow | undefined;
  return row ?? null;
}

export function inviteUsable(invite: TeamInviteRow): boolean {
  if (invite.status !== 'pending') return false;
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) return false;
  return true;
}

export function inviteExpired(invite: TeamInviteRow): boolean {
  return invite.status === 'pending' && Boolean(invite.expires_at && new Date(invite.expires_at).getTime() < Date.now());
}

function inviteGroupIds(invite: TeamInviteRow): string[] {
  try {
    const parsed = JSON.parse(invite.group_ids ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Acepta una invite: la marca usada (compare-and-set, así un link no sirve dos
 * veces aunque lleguen dos pedidos a la vez), suma a la persona con el rol,
 * las apps y los subequipos de la invitación y devuelve el equipo.
 */
export async function acceptInvite(invite: TeamInviteRow, userId: string): Promise<TeamRow | null> {
  if (!inviteUsable(invite)) return null;
  const db = getDb();
  const now = new Date().toISOString();
  const claim = await db
    .prepare(
      `UPDATE team_invites SET status = 'accepted', accepted_by = ?, accepted_at = ?
       WHERE id = ? AND status = 'pending' AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .run(userId, now, invite.id, now);
  if (claim.changes === 0) return null;
  const team = await getTeamById(invite.team_id);
  if (!team) return null;
  if (team.owner_id === userId) return team;
  const role = normalizeInviteRole(invite.role);
  const apps = serializeApps(parseApps(invite.apps));
  const existing = await getMembership(team, userId);
  if (!existing) {
    await addMember(team.id, userId, role, { apps: parseApps(invite.apps), invitedBy: invite.invited_by });
  } else if (existing.role === 'guest' && role !== 'guest') {
    // Un guest invitado como miembro pasa a miembro (una invitación nunca baja el rol).
    await db.prepare('UPDATE team_members SET role = ?, apps = ? WHERE team_id = ? AND user_id = ?').run(role, apps, team.id, userId);
  } else if (existing.role === 'member' && role === 'admin') {
    await db.prepare("UPDATE team_members SET role = 'admin' WHERE team_id = ? AND user_id = ?").run(team.id, userId);
  }
  const groupIds = role === 'guest' ? [] : inviteGroupIds(invite);
  if (groupIds.length) {
    const { addPersonToGroups } = await import('./workspace-groups');
    await addPersonToGroups(team.owner_id, userId, groupIds);
  }
  return team;
}

export async function revokeInvite(inviteId: string, teamId: string): Promise<boolean> {
  const res = await getDb()
    .prepare("UPDATE team_invites SET status = 'revoked' WHERE id = ? AND team_id = ? AND status = 'pending'")
    .run(inviteId, teamId);
  return res.changes > 0;
}

/** Renueva el vencimiento de una invitación pendiente (al reenviarla). */
export async function renewInvite(inviteId: string, teamId: string): Promise<void> {
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();
  await getDb()
    .prepare("UPDATE team_invites SET expires_at = ? WHERE id = ? AND team_id = ? AND status = 'pending'")
    .run(expires, inviteId, teamId);
}

// ---------- Workspace activo ----------

/** Cambia el workspace activo. Un guest no puede entrar a un workspace ajeno. */
export async function setActiveTeam(userId: string, teamId: string | null): Promise<boolean> {
  if (teamId !== null) {
    const team = await getTeamById(teamId);
    if (!team) return false;
    const m = await getMembership(team, userId);
    if (!m || m.role === 'guest') return false;
  }
  await getDb().prepare('UPDATE users SET active_team_id = ? WHERE id = ?').run(teamId, userId);
  return true;
}

export interface ResolvedWorkspace {
  /** Dueño de los datos (el usuario mismo en su workspace). */
  owner: UserRow;
  /**
   * Equipo cuyo id usan Track y Chat como clave (solo equipos de antes de 128,
   * keyed_by = 'team'). null = las apps usan el id del owner.
   */
  team: TeamRow | null;
  /** Ficha del workspace activo: nombre, logo, modo, miembros. */
  workspace: TeamRow;
  role: TeamRole;
  apps: AppAccess;
}

/**
 * Resuelve el workspace efectivo del usuario. Si tiene active_team_id y sigue
 * siendo parte (no guest), devuelve el owner del equipo (los datos viven bajo
 * su id). Si el equipo ya no existe o lo sacaron, limpia la preferencia: el
 * acceso se corta en ese mismo request.
 */
export async function resolveWorkspace(user: UserRow): Promise<ResolvedWorkspace> {
  const own = async (): Promise<ResolvedWorkspace> => ({
    owner: user,
    team: null,
    workspace: await ensureWorkspace(user.id),
    role: 'owner',
    apps: '*',
  });
  if (!user.active_team_id) return own();
  const team = await getTeamById(user.active_team_id);
  if (team && team.owner_id === user.id) {
    // Equipo propio: los de antes de 128 siguen con su clave; la ficha nueva es el workspace propio.
    return { owner: user, team: teamKeyed(team) ? team : null, workspace: team, role: 'owner', apps: '*' };
  }
  const membership = team ? await getMembership(team, user.id) : null;
  if (!team || !membership || membership.role === 'guest') {
    await getDb()
      .prepare('UPDATE users SET active_team_id = NULL WHERE id = ? AND active_team_id = ?')
      .run(user.id, user.active_team_id);
    return own();
  }
  const owner = (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(team.owner_id)) as UserRow | undefined;
  if (!owner) return own();
  return {
    owner,
    team: teamKeyed(team) ? team : null,
    workspace: team,
    role: normalizeRole(membership.role),
    apps: membership.apps,
  };
}
