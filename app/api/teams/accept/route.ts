import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getCurrentUser, realUserId } from '@/lib/session';
import { acceptInvite, getInviteByToken, inviteAcceptsEmail, inviteExpired, inviteUsable, normalizeInviteRole, setActiveTeam } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Aceptar una invitación por token. El link es de un solo uso: la segunda
 * vez responde invite_invalid. Si la sesión es de otro email que el
 * invitado: por defecto no se puede (email_required); si el admin permitió
 * otro email al reenviarla, pide confirmación (`confirm: true`).
 * Miembros y admins entran directo al workspace; un guest sigue en el suyo
 * y ve lo que le compartan.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const real = user.actingUser ?? user;
  const realId = realUserId(user);
  const limit = await rateLimit(`teams:accept:${realId}`, 20, 600);
  if (!limit.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { token?: string; confirm?: boolean } | null;
  if (!body?.token || typeof body.token !== 'string') return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const invite = await getInviteByToken(body.token);
  if (!invite) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!inviteUsable(invite)) {
    return NextResponse.json({ error: inviteExpired(invite) ? 'invite_expired' : 'invite_invalid' }, { status: 400 });
  }
  const sameEmail = !invite.email || invite.email.toLowerCase() === real.email.toLowerCase();
  if (!sameEmail && !inviteAcceptsEmail(invite, real.email)) {
    // Por defecto (y siempre para admins) solo se acepta con el email invitado.
    return NextResponse.json({ error: 'email_required', inviteEmail: invite.email, email: real.email }, { status: 403 });
  }
  if (!sameEmail && body.confirm !== true) {
    return NextResponse.json({ error: 'email_mismatch', inviteEmail: invite.email, email: real.email }, { status: 409 });
  }
  const team = await acceptInvite(invite, realId);
  if (!team) return NextResponse.json({ error: 'invite_invalid' }, { status: 400 });
  const role = normalizeInviteRole(invite.role);
  // El owner ya vive en su workspace; un guest no entra (solo ve lo compartido).
  if (team.owner_id !== realId && role !== 'guest') await setActiveTeam(realId, team.id);
  const next = !real.onboarded_at ? '/app/welcome?invited=1' : role === 'guest' ? '/app/docs' : '/app';
  return NextResponse.json({ ok: true, team: { id: team.id, name: team.name }, role, next });
}
