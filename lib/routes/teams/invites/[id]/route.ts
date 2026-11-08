import { NextRequest, NextResponse } from 'next/server';
import { approveJoinRequest, getInvite, revokeInvite, setInviteAnyEmail } from '@/lib/teams';
import { canGrantApps, parseApps } from '@/lib/workspace';
import { canHandleInvite } from '@/lib/workspace-directory';
import { isResponse, publicBase, teamsCtx, teamsError } from '@/lib/teams-http';
import { resendInvite } from '@/lib/workspace-invites';
import { audit } from '@/lib/workspace-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Revocar una invitación pendiente (owner o admin): el link deja de servir. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  const current = await getInvite(params.id, ctx.team.id);
  if (!current) return teamsError('not_found', 404);
  // Revocar es manejar la invitación: solo quien la podría haber hecho (un pedido de ingreso lo cierra cualquier admin).
  if (current.kind !== 'request' && !canHandleInvite(ctx.role, ctx.user.apps ?? '*', current)) return teamsError('forbidden', 403);
  if (!(await revokeInvite(params.id, ctx.team.id))) return teamsError('not_found', 404);
  await audit({ teamId: ctx.team.id, actorId: ctx.realId, targetLabel: current.email, action: 'invite.revoke', before: { role: current.role, inviteId: current.id } });
  return NextResponse.json({ ok: true });
}

/**
 * POST: reenviar el email (renueva el vencimiento; una vez por minuto y cinco
 * por día). `{ allowAnyEmail }` deja aceptarla con otro email (nunca a un
 * admin). `{ action: 'approve' }` aprueba un pedido de ingreso por dominio.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  const body = (await req.json().catch(() => ({}))) as { action?: string; allowAnyEmail?: boolean };
  if (body.action === 'approve') {
    // Aprobar da las apps del pedido: quien aprueba tiene que tenerlas.
    const request = await getInvite(params.id, ctx.team.id);
    if (request && !canGrantApps(ctx.user.apps ?? '*', parseApps(request.apps))) return teamsError('apps_not_yours', 403);
    if (!(await approveJoinRequest(params.id, ctx.team.id, ctx.realId))) return teamsError('not_found', 404);
    return NextResponse.json({ ok: true });
  }
  const current = await getInvite(params.id, ctx.team.id);
  if (!current) return teamsError('not_found', 404);
  if (!current.email) return teamsError('link_invite');
  // Reenviar da el link: solo quien podría haber hecho esa invitación.
  if (!canHandleInvite(ctx.role, ctx.user.apps ?? '*', current)) return teamsError('apps_not_yours', 403);
  // Abrirla a otro email es mandarla a otra persona: solo quien la hizo o el owner.
  if (typeof body.allowAnyEmail === 'boolean') {
    if (ctx.role !== 'owner' && current.invited_by !== ctx.realId) return teamsError('forbidden', 403);
    await setInviteAnyEmail(params.id, ctx.team.id, body.allowAnyEmail);
  }
  const res = await resendInvite({
    team: ctx.team,
    inviteId: params.id,
    inviter: { id: ctx.realId, name: ctx.real.name, email: ctx.real.email },
    base: publicBase(req),
  });
  if ('error' in res && (res.error === 'not_found' || res.error === 'rate_limited') && !('status' in res)) {
    return teamsError(res.error, res.error === 'rate_limited' ? 429 : 404);
  }
  return NextResponse.json(res);
}
