import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { getDb } from '@/lib/db';
import { trackWorkspaceId } from '@/lib/track-labels';
import {
  addProjectAccess,
  listGuests,
  listProjectAccess,
  removeGuest,
  removeProjectAccess,
  setGuest,
  setProjectVisibility,
} from '@/lib/track-access';
import { recordAudit } from '@/lib/track-audit';
import { trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Acceso de Track (solo admins): proyectos con su visibilidad y miembros,
 * invitados y personas del team. En un workspace personal no hay a quién
 * restringir, así que devuelve `personal: true`.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  const teamId = user.team?.id ?? null;
  if (!teamId) return NextResponse.json({ personal: true, projects: [], guests: [], people: [] });
  const db = getDb();
  const projects = (await db
    .prepare("SELECT id, name, icon, visibility, status FROM track_projects WHERE team_id = ? ORDER BY status = 'archived', name")
    .all(teamId)) as Array<{ id: string; name: string; icon: string | null; visibility: string | null; status: string }>;
  const out = [];
  for (const p of projects) {
    out.push({
      id: p.id,
      name: p.name,
      icon: p.icon,
      status: p.status,
      visibility: p.visibility === 'private' ? 'private' : 'workspace',
      members: p.visibility === 'private' ? await listProjectAccess(p.id) : [],
    });
  }
  const people = (await db
    .prepare(
      `SELECT u.id, u.email, u.name, m.role FROM team_members m JOIN users u ON u.id = m.user_id
       WHERE m.team_id = ? ORDER BY m.role = 'owner' DESC, u.name, u.email`,
    )
    .all(teamId)) as Array<{ id: string; email: string; name: string | null; role: string }>;
  return NextResponse.json({ personal: false, me: realUserId(user), projects: out, guests: await listGuests(teamId), people });
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('visibility'), projectId: z.string().min(1).max(64), visibility: z.enum(['workspace', 'private']) }),
  z.object({ action: z.literal('addMember'), projectId: z.string().min(1).max(64), userId: z.string().min(1).max(64) }),
  z.object({ action: z.literal('removeMember'), projectId: z.string().min(1).max(64), userId: z.string().min(1).max(64) }),
  z.object({ action: z.literal('setGuest'), email: z.string().trim().email().max(200), projectIds: z.array(z.string().min(1).max(64)).max(100) }),
  z.object({ action: z.literal('removeGuest'), email: z.string().trim().email().max(200) }),
]);

/** Cambios de acceso: visibilidad, miembros de un proyecto privado e invitados. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  const teamId = user.team?.id ?? null;
  if (!teamId) return trackError(400, 'personal_workspace');
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return trackError(400, 'invalid_input');
  const a = parsed.data;
  const actor = realUserId(user);
  const db = getDb();
  const ws = trackWorkspaceId(teamId, user.id);

  const project =
    'projectId' in a
      ? ((await db.prepare('SELECT id, name FROM track_projects WHERE id = ? AND team_id = ?').get(a.projectId, teamId)) as
          | { id: string; name: string }
          | undefined)
      : undefined;
  if ('projectId' in a && !project) return trackError(404, 'not_found');
  const isTeamMember = async (userId: string) =>
    Boolean(await db.prepare('SELECT 1 AS ok FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, userId));

  if (a.action === 'visibility') {
    await setProjectVisibility(a.projectId, a.visibility, actor);
    await recordAudit({ workspaceId: ws, actorId: actor, action: 'project.visibility', entityType: 'project', entityId: a.projectId, entityLabel: project?.name, projectId: a.projectId, data: { visibility: a.visibility } });
  } else if (a.action === 'addMember') {
    if (!(await isTeamMember(a.userId))) return trackError(400, 'not_a_member');
    await addProjectAccess(a.projectId, a.userId, actor);
    await recordAudit({ workspaceId: ws, actorId: actor, action: 'access.member_added', entityType: 'access', entityId: a.userId, entityLabel: project?.name, projectId: a.projectId });
  } else if (a.action === 'removeMember') {
    await removeProjectAccess(a.projectId, a.userId);
    await recordAudit({ workspaceId: ws, actorId: actor, action: 'access.member_removed', entityType: 'access', entityId: a.userId, entityLabel: project?.name, projectId: a.projectId });
  } else if (a.action === 'setGuest') {
    // Un admin no puede quedar como invitado (se quitaría el acceso a sí mismo).
    const target = (await db
      .prepare('SELECT m.role FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND lower(u.email) = lower(?)')
      .get(teamId, a.email)) as { role: string } | undefined;
    if (target && target.role !== 'member') return trackError(400, 'admin_cannot_be_guest');
    const guest = await setGuest(ws, a.email, a.projectIds, actor);
    await recordAudit({ workspaceId: ws, actorId: actor, action: 'access.guest_set', entityType: 'access', entityLabel: a.email, data: { projects: guest.projectIds.length } });
  } else if (a.action === 'removeGuest') {
    await removeGuest(ws, a.email);
    await recordAudit({ workspaceId: ws, actorId: actor, action: 'access.guest_removed', entityType: 'access', entityLabel: a.email });
  }
  return GET();
}
