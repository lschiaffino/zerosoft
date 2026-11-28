/**
 * Track — chequeo de roles por team para las rutas con sesión
 * (lib/track-team-roles). `area` es un área configurable del team o 'owner'
 * para lo que es solo de dueños y admins. Siempre contra el team que se toca:
 * ser dueño de un team no da nada sobre otro.
 */
import { isWorkspaceAdmin, realUserId, type SessionUser } from './session';
import { teamCapabilities, type TeamArea } from './track-team-roles';
import { getLabel } from './track-labels';
import { canAccessTrackProject, getProject } from './track-data';
import type { TrackProjectRow } from './schema/types';

export async function teamCan(
  user: SessionUser,
  project: Pick<TrackProjectRow, 'id' | 'team_id' | 'owner_id'> & { team_permissions?: string | null },
  area: TeamArea | 'owner',
): Promise<boolean> {
  const caps = await teamCapabilities(project, realUserId(user), isWorkspaceAdmin(user));
  return caps[area];
}

/**
 * ¿Puede tocar `area` del team `projectId`? El team tiene que existir y verse
 * desde el workspace activo; si no, false (la ruta responde como si no existiera).
 */
export async function teamCanById(user: SessionUser, projectId: string | null | undefined, area: TeamArea | 'owner'): Promise<boolean> {
  if (!projectId) return false;
  const project = await getProject(projectId);
  if (!project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) return false;
  return teamCan(user, project, area);
}

/** Un label de team solo se agrupa bajo un grupo general (sin team) o del mismo team. */
export async function teamLabelParentOk(workspaceId: string, parentId: string, projectId: string): Promise<boolean> {
  const parent = await getLabel(workspaceId, parentId);
  return Boolean(parent) && (!parent!.project_id || parent!.project_id === projectId);
}
