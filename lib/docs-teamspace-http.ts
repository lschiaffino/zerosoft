/**
 * Docs: permisos de las rutas de teamspaces. Owners del teamspace y admins
 * del workspace lo administran; cualquiera se une a uno abierto.
 */
import { z } from 'zod';
import type { SessionUser } from './session';
import { isWorkspaceAdmin, realUserId } from './session';
import { getTeamspace, teamspaceRoleOf, type DocsTeamspace } from './docs-access';
import { listPageMentionables } from './docs';

export const teamspaceCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  icon: z.string().trim().max(16).nullish(),
  description: z.string().trim().max(500).optional(),
  access: z.enum(['open', 'closed', 'private']).optional(),
  member_role: z.enum(['view', 'comment', 'edit', 'full']).optional(),
});

export const teamspaceUpdateSchema = teamspaceCreateSchema.partial();

export const teamspaceMemberSchema = z.object({
  user_id: z.string().min(1).max(64),
  role: z.enum(['owner', 'member']).optional(),
});

export type TeamspaceGate =
  | { ok: true; ts: DocsTeamspace; manage: boolean; myRole: 'owner' | 'member' | null }
  | { ok: false; status: 404 | 403 };

/** Teamspace del workspace activo que la persona puede ver (privado: solo miembros). */
export async function gateTeamspace(user: SessionUser, id: string): Promise<TeamspaceGate> {
  const ts = await getTeamspace(id);
  if (!ts || ts.workspace_id !== user.id) return { ok: false, status: 404 };
  const myRole = await teamspaceRoleOf(ts.id, realUserId(user));
  const admin = isWorkspaceAdmin(user);
  if (ts.access === 'private' && !myRole && !admin) return { ok: false, status: 404 };
  return { ok: true, ts, manage: admin || myRole === 'owner', myRole };
}

/** Ids de las personas del workspace (dueño y miembros de sus equipos). */
export async function workspacePeople(workspaceId: string): Promise<Set<string>> {
  return new Set((await listPageMentionables({ user_id: workspaceId })).map((m) => m.id));
}
