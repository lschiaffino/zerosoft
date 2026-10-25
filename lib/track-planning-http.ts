/**
 * Track, planificación — contexto común de las rutas API: sesión, alcance del
 * workspace (team activo o personal) e id real de quien actúa.
 */
import { getCurrentUser, isWorkspaceAdmin, realUserId, type SessionUser } from './session';
import type { WorkspaceScope } from './track-plans';

export interface PlanningContext {
  user: SessionUser;
  scope: WorkspaceScope;
  /** Persona real (no el dueño del workspace). */
  actorId: string;
  admin: boolean;
}

export async function planningContext(): Promise<PlanningContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return {
    user,
    scope: { teamId: user.team?.id ?? null, ownerId: user.id },
    actorId: realUserId(user),
    admin: isWorkspaceAdmin(user),
  };
}

export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}
