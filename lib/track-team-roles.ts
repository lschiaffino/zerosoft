/**
 * Track — roles por team, como los team owners de Linear.
 *
 * - Un team puede tener dueños (track_team_roles). Quien crea un team queda
 *   como dueño. Los admins del workspace cuentan como dueños de todo team que
 *   ven. Un invitado (track_guests o rol 'guest' del workspace) nunca es dueño.
 * - Solo los dueños: borrar el team, cambiar su visibilidad (privado o no),
 *   dar o sacar el rol de dueño, cambiar los permisos del team y los ajustes
 *   delicados (identificador, archivar, triage y sus reglas, cycles
 *   automáticos, estimates, auto-cierre, borrar estados).
 * - Por área (team_permissions) los dueños eligen si la maneja cualquier
 *   miembro o solo los dueños: ajustes del team (nombre, ícono, estados),
 *   labels del team, plantillas y miembros (sumar gente a un team privado).
 * - Todas las áreas arrancan en "solo dueños" (DEFAULT_TEAM_PERMISSIONS): un
 *   miembro común no cambia los ajustes. Un team nuevo nace con su creador
 *   como dueño; uno de antes, sin dueños, lo manejan los admins hasta que
 *   nombren alguno.
 * - Un dueño maneja solo su team: el chequeo es siempre contra el team que se
 *   toca, nunca contra "es dueño de algún team".
 */
import { getDb } from './db';
import { isGuest } from './track-access';
import type { TrackProjectRow } from './schema/types';

import { capabilitiesFor, parseTeamPermissions, type TeamCapabilities, type TeamPermissions } from './track-team-areas';

export * from './track-team-areas';

export async function listTeamOwnerIds(projectId: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare("SELECT user_id FROM track_team_roles WHERE project_id = ? AND role = 'owner'")
    .all(projectId)
    .catch(() => [])) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

export async function isTeamOwner(projectId: string, userId: string): Promise<boolean> {
  const row = await getDb()
    .prepare("SELECT 1 AS ok FROM track_team_roles WHERE project_id = ? AND user_id = ? AND role = 'owner'")
    .get(projectId, userId)
    .catch(() => undefined);
  return Boolean(row);
}

type ProjectLike = Pick<TrackProjectRow, 'id' | 'team_id' | 'owner_id'> & { team_permissions?: string | null };

/** ¿La persona es invitada en el workspace del team? (no puede ser dueña). */
export async function isTeamGuest(project: Pick<TrackProjectRow, 'team_id' | 'owner_id'>, personId: string): Promise<boolean> {
  const ws = project.team_id ?? project.owner_id;
  if (!ws) return false;
  if (await isGuest(ws, personId)) return true;
  if (!project.team_id) return false;
  const row = await getDb()
    .prepare("SELECT 1 AS ok FROM team_members WHERE team_id = ? AND user_id = ? AND role = 'guest'")
    .get(project.team_id, personId);
  return Boolean(row);
}

/** Qué puede la persona en el team (ya se sabe que lo ve). */
export async function teamCapabilities(project: ProjectLike, personId: string, workspaceAdmin: boolean): Promise<TeamCapabilities> {
  const permissions = parseTeamPermissions(project.team_permissions);
  const teamOwner = (await isTeamOwner(project.id, personId)) && !(await isTeamGuest(project, personId));
  return capabilitiesFor({ workspaceAdmin, teamOwner, permissions });
}

/** Da o saca el rol de dueño. */
export async function setTeamRole(projectId: string, userId: string, role: 'owner' | 'member', addedBy: string): Promise<void> {
  const db = getDb();
  if (role === 'owner') {
    await db
      .prepare("INSERT INTO track_team_roles (project_id, user_id, role, added_by) VALUES (?, ?, 'owner', ?) ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'owner'")
      .run(projectId, userId, addedBy);
  } else {
    await db.prepare('DELETE FROM track_team_roles WHERE project_id = ? AND user_id = ?').run(projectId, userId);
  }
}

export async function setTeamPermissions(projectId: string, permissions: TeamPermissions): Promise<void> {
  await getDb()
    .prepare("UPDATE track_projects SET team_permissions = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(permissions), projectId);
}

/** Quien crea un team queda como su dueño (como en Linear). No falla si la migración todavía no corrió. */
export async function makeCreatorOwner(projectId: string, userId: string): Promise<void> {
  await setTeamRole(projectId, userId, 'owner', userId).catch(() => undefined);
}

/** Saca a alguien de un team privado: también pierde el rol de dueño. */
export async function removeFromPrivateTeam(projectId: string, userId: string): Promise<void> {
  await getDb()
    .prepare('DELETE FROM track_team_roles WHERE project_id = ? AND user_id = ?')
    .run(projectId, userId)
    .catch(() => undefined);
}
