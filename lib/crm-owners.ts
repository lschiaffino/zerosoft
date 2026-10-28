/**
 * CRM — personas del workspace activo como opciones de owner (server-only).
 * Mismo criterio que las fichas de contacto y empresa: los miembros del team
 * activo, o solo el dueño en el workspace personal.
 */
import { listMembers } from './teams';
import type { SessionUser } from './session';
import { workspaceTeamId } from './workspace';

export async function ownerOptions(user: SessionUser): Promise<Array<{ value: string; label: string }>> {
  const members = workspaceTeamId(user)
    ? await listMembers(workspaceTeamId(user)!)
    : [{ user_id: user.id, email: user.email, name: user.name ?? null }];
  return members.map((m) => ({ value: m.user_id, label: m.name || m.email }));
}
