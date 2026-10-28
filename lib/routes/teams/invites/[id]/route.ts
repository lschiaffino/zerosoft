import { NextRequest, NextResponse } from 'next/server';
import { approveJoinRequest, revokeInvite, setInviteAnyEmail } from '@/lib/teams';
import { isResponse, publicBase, teamsCtx, teamsError } from '@/lib/teams-http';
import { resendInvite } from '@/lib/workspace-invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Revocar una invitación pendiente (owner o admin): el link deja de servir. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  if (!(await revokeInvite(params.id, ctx.team.id))) return teamsError('not_found', 404);
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
    if (!(await approveJoinRequest(params.id, ctx.team.id, ctx.realId))) return teamsError('not_found', 404);
    return NextResponse.json({ ok: true });
  }
  if (typeof body.allowAnyEmail === 'boolean') await setInviteAnyEmail(params.id, ctx.team.id, body.allowAnyEmail);
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
