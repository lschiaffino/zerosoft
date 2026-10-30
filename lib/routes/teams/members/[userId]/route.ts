import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { getMemberRole, removeMember, setMemberApps, setMemberRole } from '@/lib/teams';
import { canManage, isResponse, teamsCtx, teamsError } from '@/lib/teams-http';
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
  const targetRole = await getMemberRole(ctx.team.id, params.userId);
  if (!targetRole) return teamsError('not_found', 404);
  if (params.userId === ctx.realId && body.role) return teamsError('cant_change_own_role');
  if (!canManage(ctx.role, targetRole)) return teamsError('forbidden', 403);
  if (body.role === 'admin' && ctx.role !== 'owner') return teamsError('forbidden', 403);
  if (body.role && !(await setMemberRole(ctx.team.id, params.userId, body.role))) return teamsError('not_found', 404);
  if (body.apps !== undefined) await setMemberApps(ctx.team.id, params.userId, body.apps);
  if (body.groupIds !== undefined && (body.role ?? targetRole) !== 'guest') {
    await setPersonGroups(ctx.team.owner_id, params.userId, body.groupIds);
  }
  return NextResponse.json({ ok: true });
}
