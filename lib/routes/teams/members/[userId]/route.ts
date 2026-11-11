import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { can, canGiveApps } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { getMemberCapabilities, getMemberRole, removeMember, setMemberApps, setMemberCapabilities, setMemberRole } from '@/lib/teams';
import { isCapability, parseCapabilities } from '@/lib/capabilities';
import { isResponse, requestLocale, teamsCtx, teamsError } from '@/lib/teams-http';
import { canUseApp, getMembership, parseApps, type AppAccess } from '@/lib/workspace';
import { audit, deactivateMember, forgetDeactivated, getDeactivated, ownedStuff, reactivateMember, snapshotMember, transferStuff } from '@/lib/workspace-admin';
import { personAccess } from '@/lib/workspace-access-view';
import { grantedApps, notifyAppsGranted, notifyRemoved, notifyRoleChanged, resolveRequests } from '@/lib/workspace-access-request';
import { groupIdsOf, setPersonGroups } from '@/lib/workspace-groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function label(userId: string): Promise<string> {
  const { getDb } = await import('@/lib/db');
  const row = (await getDb().prepare('SELECT name, email FROM users WHERE id = ?').get(userId)) as { name: string | null; email: string } | undefined;
  return row ? row.name || row.email : '';
}

/**
 * GET: "¿qué puede ver esta persona?": su rol, apps, equipos, el acceso que
 * tiene en cada app, lo que tiene a su cargo y los últimos cambios. Solo
 * owner y admins.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const ctx = await teamsCtx();
  if (isResponse(ctx)) return ctx;
  if (!can(ctx.user, 'members.inspect')) return teamsError('forbidden', 403);
  const view = await personAccess(ctx.team, params.userId, requestLocale(req));
  if (!view) return teamsError('not_found', 404);
  return NextResponse.json(view);
}

const deleteSchema = z.object({ transferTo: z.string().max(128).optional(), workspaceId: z.string().max(128).optional() }).nullable();

/**
 * Desactivar a una persona del workspace activo (le corta el acceso en todas
 * las apps al instante, ver lib/workspace-lifecycle.ts) guardando su ficha
 * para reactivarla. `transferTo`: a quién pasan sus issues de Track y sus
 * registros del CRM. Permitido si:
 * - sos el owner (a cualquiera menos a vos),
 * - sos admin y la otra persona es member o guest,
 * - o te vas vos (`self`), salvo que seas el owner.
 */
export async function DELETE(req: NextRequest, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const ctx = await teamsCtx();
  if (isResponse(ctx)) return ctx;
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return teamsError('invalid_input');
  const body = parsed.data ?? {};
  if (body.workspaceId && body.workspaceId !== ctx.team.id) return teamsError('wrong_workspace', 409);
  const targetId = params.userId === 'self' ? ctx.realId : params.userId;
  const targetRole = await getMemberRole(ctx.team.id, targetId);
  if (!targetRole) return teamsError('not_found', 404);
  const isSelf = targetId === ctx.realId;
  if (isSelf) {
    if (!can(ctx.user, 'members.leave')) return teamsError('owner_cant_leave');
    await removeMember(ctx.team.id, targetId);
    await forgetDeactivated(ctx.team.id, targetId);
    await audit({ teamId: ctx.team.id, actorId: ctx.realId, targetId, targetLabel: await label(targetId), action: 'member.remove', before: { role: targetRole }, after: { left: true } });
    return NextResponse.json({ ok: true });
  }
  if (!can(ctx.user, 'members.remove', { target: targetRole })) return teamsError('forbidden', 403);
  if (body.transferTo) {
    // Solo a alguien del workspace (no guest) que no sea quien se va.
    const to = body.transferTo === targetId ? null : await getMembership(ctx.team, body.transferTo);
    if (!to || to.role === 'guest') return teamsError('invalid_transfer');
  }
  const limit = await rateLimit(`teams:remove:${ctx.realId}`, 60, 3600);
  if (!limit.ok) return teamsError('rate_limited', 429);
  let moved = null;
  if (body.transferTo) {
    const to = await getMembership(ctx.team, body.transferTo);
    moved = await transferStuff(ctx.team, targetId, body.transferTo, { track: Boolean(to && canUseApp(to, 'track')), crm: Boolean(to && canUseApp(to, 'crm')) });
    await audit({ teamId: ctx.team.id, actorId: ctx.realId, targetId, targetLabel: await label(targetId), action: 'member.transfer', after: { to: body.transferTo, toLabel: await label(body.transferTo), ...moved } });
  }
  const snap = await deactivateMember(ctx.team, targetId, ctx.realId);
  await audit({ teamId: ctx.team.id, actorId: ctx.realId, targetId, targetLabel: await label(targetId), action: 'member.remove', before: snap ?? { role: targetRole } });
  await notifyRemoved(ctx.team, targetId, ctx.real).catch(() => undefined);
  return NextResponse.json({ ok: true, moved });
}

const postSchema = z.object({
  action: z.enum(['reactivate', 'forget', 'owned']),
  workspaceId: z.string().max(128).optional(),
});

/**
 * POST `{ action: 'reactivate' }`: vuelve a sumar a alguien desactivado con
 * su rol, apps y equipos (quien reactiva tiene que poder dar ese rol y esas
 * apps). `forget`: lo saca de la lista de desactivados. `owned`: cuántas
 * cosas tiene a su cargo (para el diálogo de desactivar).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return teamsError('invalid_input');
  const body = parsed.data;
  if (body.workspaceId && body.workspaceId !== ctx.team.id) return teamsError('wrong_workspace', 409);
  if (body.action === 'owned') {
    const role = await getMemberRole(ctx.team.id, params.userId);
    if (!role || !can(ctx.user, 'members.remove', { target: role })) return teamsError('not_found', 404);
    return NextResponse.json(await ownedStuff(ctx.team, params.userId));
  }
  const snap = await getDeactivated(ctx.team.id, params.userId);
  if (!snap) return teamsError('not_found', 404);
  if (!can(ctx.user, 'members.manage', { target: snap.role, nextRole: snap.role })) return teamsError('forbidden', 403);
  if (body.action === 'forget') {
    await forgetDeactivated(ctx.team.id, params.userId);
    return NextResponse.json({ ok: true });
  }
  if (snap.role !== 'guest' && !canGiveApps(ctx.user, snap.apps)) return teamsError('apps_not_yours', 403);
  if (await getMemberRole(ctx.team.id, params.userId)) return teamsError('already_member', 409);
  await reactivateMember(ctx.team, params.userId, snap, ctx.realId);
  await audit({ teamId: ctx.team.id, actorId: ctx.realId, targetId: params.userId, targetLabel: await label(params.userId), action: 'member.reactivate', after: snap });
  return NextResponse.json({ ok: true });
}

const patchSchema = z.object({
  role: z.enum(['admin', 'member', 'guest']).optional(),
  apps: z.union([z.literal('*'), z.array(z.string().max(20)).max(64)]).optional(),
  groupIds: z.array(z.string().max(64)).max(100).optional(),
  /** Capacidades de un member (lib/capabilities.ts): la lista completa que queda. Claves desconocidas, 400. */
  capabilities: z.array(z.string().max(64).refine(isCapability)).max(32).optional(),
  /** El workspace que la pantalla cree estar editando: si cambió en otra pestaña, no se toca nada. */
  workspaceId: z.string().max(128).optional(),
});

/**
 * Cambiar rol, apps permitidas, subequipos o capacidades de una persona. Solo
 * owner y admins; un admin no puede tocar a otro admin ni nombrar admins.
 * Las capacidades son de members: owner y admins ya las tienen por su rol, y
 * un guest no tiene ninguna.
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
  if (!can(ctx.user, 'members.manage', { target: targetRole, nextRole: body.role, self: params.userId === ctx.realId })) return teamsError('forbidden', 403);
  const before = await getMembership(ctx.team, params.userId);
  if (!before) return teamsError('not_found', 404);
  // Sumar apps, o devolverle a un guest las que tenía guardadas, es dar acceso.
  if (body.apps !== undefined && !canGiveApps(ctx.user, parseApps(body.apps), before.role === 'guest' ? [] : before.apps)) return teamsError('apps_not_yours', 403);
  if (body.role && body.role !== 'guest' && before.role === 'guest' && !canGiveApps(ctx.user, before.apps)) return teamsError('apps_not_yours', 403);
  // Capacidades solo para quien queda como member (se valida antes de cambiar nada).
  if (body.capabilities?.length && (body.role ?? before.role) !== 'member') return teamsError('caps_members_only');
  const who = await label(params.userId);
  if (body.role && body.role !== before.role) {
    if (!(await setMemberRole(ctx.team.id, params.userId, body.role))) return teamsError('not_found', 404);
    await audit({ teamId: ctx.team.id, actorId: ctx.realId, targetId: params.userId, targetLabel: who, action: 'member.role', before: { role: before.role }, after: { role: body.role } });
    await notifyRoleChanged(ctx.team, params.userId, ctx.real, body.role).catch(() => undefined);
  }
  if (body.apps !== undefined) {
    const next: AppAccess = parseApps(body.apps);
    await setMemberApps(ctx.team.id, params.userId, body.apps);
    const after = await getMembership(ctx.team, params.userId);
    if (JSON.stringify(before.apps) !== JSON.stringify(next)) {
      await audit({ teamId: ctx.team.id, actorId: ctx.realId, targetId: params.userId, targetLabel: who, action: 'member.apps', before: { apps: before.apps }, after: { apps: next } });
    }
    // Quien recibe apps nuevas se entera (también si las había pedido). Un guest no usa apps.
    if (after && after.role !== 'guest') {
      await notifyAppsGranted(ctx.team, params.userId, ctx.real, grantedApps(before.apps, after.apps)).catch(() => undefined);
      await resolveRequests(ctx.team.id, params.userId, after.apps, 'granted', ctx.realId).catch(() => undefined);
    }
  }
  if (body.capabilities !== undefined) {
    const next = parseCapabilities(body.capabilities);
    const prev = await getMemberCapabilities(ctx.team.id, params.userId);
    if (prev.join() !== next.join()) {
      if (!(await setMemberCapabilities(ctx.team.id, params.userId, next))) return teamsError('not_found', 404);
      await audit({ teamId: ctx.team.id, actorId: ctx.realId, targetId: params.userId, targetLabel: who, action: 'member.caps', before: { caps: prev }, after: { caps: next } });
    }
  }
  if (body.groupIds !== undefined && (body.role ?? targetRole) !== 'guest') {
    const prev = await groupIdsOf(ctx.team.owner_id, params.userId);
    await setPersonGroups(ctx.team.owner_id, params.userId, body.groupIds);
    const now = await groupIdsOf(ctx.team.owner_id, params.userId);
    if ([...prev].sort().join() !== [...now].sort().join()) {
      await audit({ teamId: ctx.team.id, actorId: ctx.realId, targetId: params.userId, targetLabel: who, action: 'member.teams', before: { groupIds: prev }, after: { groupIds: now } });
    }
  }
  return NextResponse.json({ ok: true, member: await snapshotMember(ctx.team, params.userId) });
}
