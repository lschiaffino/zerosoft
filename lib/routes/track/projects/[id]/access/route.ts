import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { canAccessTrackProject, getProject, listProjectMembers } from '@/lib/track-data';
import { addProjectAccess, listGuests, listProjectAccess, removeProjectAccess, setProjectVisibility } from '@/lib/track-access';
import { trackAccessScope } from '@/lib/track-access-scope';
import { recordAudit } from '@/lib/track-audit';
import { trackWorkspaceId } from '@/lib/track-labels';
import {
  TEAM_AREAS,
  listTeamOwnerIds,
  parseTeamPermissions,
  removeFromPrivateTeam,
  setTeamPermissions,
  setTeamRole,
  teamCapabilities,
} from '@/lib/track-team-roles';
import { notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

async function load(id: string) {
  const user = await getCurrentUser();
  if (!user) return { res: unauthorized() } as const;
  const project = await getProject(id);
  if (!project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) return { res: notFound() } as const;
  const actor = realUserId(user);
  const caps = await teamCapabilities(project, actor, isWorkspaceAdmin(user));
  return { user, project, actor, caps } as const;
}

async function view(user: SessionUser, projectId: string) {
  const project = (await getProject(projectId))!;
  const actor = realUserId(user);
  const caps = await teamCapabilities(project, actor, isWorkspaceAdmin(user));
  const scope = await trackAccessScope(user);
  const ws = trackWorkspaceId(scope.teamId, user.id);
  const guests = new Set((await listGuests(ws)).map((g) => g.email.toLowerCase()));
  const roleOf = new Map(scope.people.map((p) => [p.id, p.role]));
  const owners = new Set(await listTeamOwnerIds(project.id));
  const isPrivate = project.visibility === 'private';
  const members = (await listProjectMembers(project.id, user.id)).map((m) => {
    const wsRole = roleOf.get(m.id) ?? m.role;
    const guest = guests.has(m.email.toLowerCase()) || m.role === 'guest';
    return {
      id: m.id,
      name: m.name,
      email: m.email,
      teamRole: owners.has(m.id) && !guest ? ('owner' as const) : ('member' as const),
      workspaceAdmin: wsRole === 'owner' || wsRole === 'admin',
      guest,
    };
  });
  // Gente del workspace que todavía no está en el team privado (para sumarla).
  const inTeam = isPrivate ? new Set((await listProjectAccess(project.id)).map((m) => m.userId)) : new Set<string>();
  const candidates =
    isPrivate && caps.members && !scope.personal
      ? scope.people.filter((p) => !inTeam.has(p.id) && !guests.has(p.email.toLowerCase())).map((p) => ({ id: p.id, name: p.name, email: p.email }))
      : [];
  return {
    personal: scope.personal,
    me: actor,
    visibility: isPrivate ? 'private' : 'workspace',
    permissions: parseTeamPermissions(project.team_permissions),
    can: caps,
    members,
    candidates,
  };
}

/** Miembros del team con su rol, permisos del team y lo que puede quien mira. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await load(id);
  if ('res' in ctx) return ctx.res;
  return NextResponse.json(await view(ctx.user, ctx.project.id));
}

const mode = z.enum(['members', 'owners']).optional();
const permissionsSchema = z.object({ settings: mode, labels: mode, templates: mode, members: mode });

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('addMember'), userId: z.string().min(1).max(64) }),
  z.object({ action: z.literal('removeMember'), userId: z.string().min(1).max(64) }),
  z.object({ action: z.literal('setRole'), userId: z.string().min(1).max(64), role: z.enum(['owner', 'member']) }),
  z.object({ action: z.literal('visibility'), visibility: z.enum(['workspace', 'private']) }),
  z.object({ action: z.literal('permissions'), permissions: permissionsSchema }),
]);

/**
 * Cambios del team: sumar o sacar miembros de un team privado, dar o sacar el
 * rol de dueño, cambiar la visibilidad y los permisos. Lo delicado es de los
 * dueños (y de los admins del workspace); sumar miembros, según el permiso.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await load(id);
  if ('res' in ctx) return ctx.res;
  const { user, project, actor, caps } = ctx;
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return trackError(400, 'invalid_input');
  const a = parsed.data;
  const scope = await trackAccessScope(user);
  if (scope.personal) return trackError(400, 'personal_workspace');
  const ws = trackWorkspaceId(scope.teamId, user.id);
  const isPrivate = project.visibility === 'private';
  const audit = (action: string, data?: Record<string, unknown>, entityId?: string) =>
    recordAudit({ workspaceId: ws, actorId: actor, action, entityType: a.action === 'visibility' || a.action === 'permissions' ? 'project' : 'access', entityId: entityId ?? project.id, entityLabel: project.name, projectId: project.id, data });

  if (a.action === 'addMember') {
    if (!isPrivate) return trackError(400, 'not_private');
    if (!caps.members) return trackError(403, 'forbidden');
    if (!(await scope.isMember(a.userId))) return trackError(400, 'not_a_member');
    const guests = new Set((await listGuests(ws)).map((g) => g.email.toLowerCase()));
    const target = scope.people.find((p) => p.id === a.userId);
    if (target && guests.has(target.email.toLowerCase())) return trackError(400, 'guest');
    await addProjectAccess(project.id, a.userId, actor);
    await audit('access.member_added', undefined, a.userId);
  } else if (a.action === 'removeMember') {
    if (!isPrivate) return trackError(400, 'not_private');
    // Irse del team lo puede cualquiera; sacar a otro, los dueños.
    if (a.userId !== actor && !caps.owner) return trackError(403, 'forbidden');
    await removeProjectAccess(project.id, a.userId);
    await removeFromPrivateTeam(project.id, a.userId);
    await audit('access.member_removed', undefined, a.userId);
  } else if (a.action === 'setRole') {
    if (!caps.owner) return trackError(403, 'forbidden');
    if (a.role === 'owner') {
      const members = await listProjectMembers(project.id, user.id);
      const target = members.find((m) => m.id === a.userId);
      if (!target || !(await scope.isMember(a.userId))) return trackError(400, 'not_a_member');
      const guests = new Set((await listGuests(ws)).map((g) => g.email.toLowerCase()));
      if (target.role === 'guest' || guests.has(target.email.toLowerCase())) return trackError(400, 'guest_cannot_be_owner');
    }
    await setTeamRole(project.id, a.userId, a.role, actor);
    await audit('access.role_changed', { role: a.role }, a.userId);
  } else if (a.action === 'visibility') {
    if (!caps.owner) return trackError(403, 'forbidden');
    await setProjectVisibility(project.id, a.visibility, actor);
    await audit('project.visibility', { visibility: a.visibility });
  } else if (a.action === 'permissions') {
    if (!caps.owner) return trackError(403, 'forbidden');
    const next = { ...parseTeamPermissions(project.team_permissions) };
    for (const area of TEAM_AREAS) {
      const v = a.permissions[area];
      if (v) next[area] = v;
    }
    await setTeamPermissions(project.id, next);
    await audit('project.permissions', next);
  }
  // Quien se fue de un team privado ya no lo ve.
  const stillSees = await canAccessTrackProject((await getProject(project.id))!, user.team?.id ?? null, user.id);
  if (!stillSees) return NextResponse.json({ left: true });
  return NextResponse.json(await view(user, project.id));
}
