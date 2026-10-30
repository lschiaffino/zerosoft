/**
 * Lo que necesita cada página de Analytics: la sesión, el proyecto que se
 * mira y si la persona administra (proyectos, keys, borrar personas).
 */
import { requireUser, type SessionUser } from '../session';
import { roleAtLeast } from '../teams';
import { currentProject, type ProjectRow } from './projects';

export interface AnalyticsPageCtx {
  user: SessionUser;
  project: ProjectRow | null;
  projects: ProjectRow[];
  canManage: boolean;
  personId: string;
}

export async function analyticsPage(locale: string, wantedProject?: string | null): Promise<AnalyticsPageCtx> {
  const user = await requireUser(locale);
  const { project, projects } = await currentProject(user.id, wantedProject ?? null);
  return { user, project, projects, canManage: roleAtLeast(user.role, 'admin'), personId: user.actingUser?.id ?? user.id };
}
