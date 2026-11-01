import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { getMemberRole, removeMember, setMemberApps, setMemberRole } from '@/lib/teams';
import { canManage, isResponse, teamsCtx, teamsError } from '@/lib/teams-http';
import { getMembership } from '@/lib/workspace';
import { grantedApps, notifyAppsGranted } from '@/lib/workspace-access-request';
import { setPersonGroups } from '@/lib/workspace-groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sacar a una persona del workspace activo (le corta el acceso en todas las
 * apps al instante, ver lib/workspace-lifecycle.ts). Permitido si:
 * - sos el owner (a cualquiera menos a vos),
 * - sos admin y la otra persona es member o guest,
 * - o te vas vos (`self`), salvo que seas el owner.
 */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const ctx = await teamsCtx();
  if (isResponse(ctx)) return ctx;
  const targetId = params.userId === 'self' ? ctx.realId : params.userId;
  const targetRole = await getMemberRole(ctx.team.id, targetId);
  if (!targetRole) return teamsError('not_found', 404);
  const isSelf = targetId === ctx.realId;
  if (isSelf && ctx.role === 'owner') return teamsError('owner_cant_leave');
  if (!isSelf && !canManage(ctx.role, targetRole)) return teamsError('forbidden', 403);
  const limit = await rateLimit(`teams:remove:${ctx.realId}`, 60, 3600);
  if (!limit.ok) return teamsError('rate_limited', 429);
  await removeMember(ctx.team.id, targetId);
  return NextResponse.json({ ok: true });
}

const patchSchema = z.object({
  role: z.enum(['admin', 'member', 'guest']).optional(),
  apps: z.union([z.literal('*'), z.array(z.string().max(20)).max(64)]).optional(),
  groupIds: z.array(z.string().max(64)).max(100).optional(),
  /** El workspace que la pantalla cree estar editando: si cambió en otra pestaña, no se toca nada. */
  workspaceId: z.string().max(128).optional(),
});

/**
 * Cambiar rol, apps permitidas o subequipos de una persona. Solo owner y
 * admins; un admin no puede tocar a otro admin ni nombrar admins.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return teamsError('invalid_input');
  const body = parsed.data;
  if (body.workspaceId && body.workspaceId !== ctx.team.id) return teamsError('wrong_workspace', 409);
  const targetRole = await getMemberRole(ctx.team.id, params.userId);
  if (!targetRole) return teamsError('not_found', 404);
  if (params.userId === ctx.realId && body.role) return teamsError('cant_change_own_role');
  if (!canManage(ctx.role, targetRole)) return teamsError('forbidden', 403);
  if (body.role === 'admin' && ctx.role !== 'owner') return teamsError('forbidden', 403);
  if (body.role && !(await setMemberRole(ctx.team.id, params.userId, body.role))) return teamsError('not_found', 404);
  if (body.apps !== undefined) {
    const before = await getMembership(ctx.team, params.userId);
    await setMemberApps(ctx.team.id, params.userId, body.apps);
    const after = await getMembership(ctx.team, params.userId);
    // Quien recibe apps nuevas se entera (también si las había pedido). Un guest no usa apps.
    if (before && after && after.role !== 'guest') {
      await notifyAppsGranted(ctx.team, params.userId, ctx.real, grantedApps(before.apps, after.apps)).catch(() => undefined);
    }
  }
  if (body.groupIds !== undefined && (body.role ?? targetRole) !== 'guest') {
    await setPersonGroups(ctx.team.owner_id, params.userId, body.groupIds);
  }
  return NextResponse.json({ ok: true });
}
