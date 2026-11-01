import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { getDb, type UserRow } from '@/lib/db';
import { resolveConsentWorkspace, sameSiteRequest } from '@/lib/oauth/consent';
import { approveAuthRequest, authorizationRedirect, denyAuthRequest, openAuthRequest } from '@/lib/oauth/store';
import { getCurrentUser, realUserId } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  request: z.string().min(1).max(100),
  decision: z.enum(['approve', 'deny']),
  scope: z.enum(['read', 'read write']).optional(),
  teamId: z.string().max(100).nullable().optional(),
});

/** La persona decide en la pantalla de permisos. Sesión más chequeo de origen: esto no sale de otro sitio. */
export async function POST(req: NextRequest) {
  if (!sameSiteRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const personId = realUserId(user);
  const limit = await rateLimit(`oauth-consent:${personId}`, 30, 60);
  if (!limit.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const pending = await openAuthRequest(parsed.data.request);
  if (!pending) return NextResponse.json({ error: 'expired' }, { status: 410 });
  if (parsed.data.decision === 'deny') {
    await denyAuthRequest(pending.id);
    return NextResponse.json({ redirect: authorizationRedirect(pending.redirect_uri, { error: 'access_denied', state: pending.state }) });
  }
  // Nunca más de lo que pidió el cliente; la persona puede bajarlo a solo lectura.
  const asked = pending.scope.split(' ');
  const chosen = parsed.data.scope ?? pending.scope;
  if (chosen.split(' ').some((s) => !asked.includes(s))) return NextResponse.json({ error: 'invalid_scope' }, { status: 400 });
  const real = (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(personId)) as UserRow;
  const team = await resolveConsentWorkspace(real, parsed.data.teamId);
  if (team === undefined) return NextResponse.json({ error: 'workspace_not_found' }, { status: 403 });
  const code = await approveAuthRequest(pending, { userId: personId, teamId: team, scope: chosen });
  if (!code) return NextResponse.json({ error: 'expired' }, { status: 410 });
  return NextResponse.json({ redirect: authorizationRedirect(pending.redirect_uri, { code, state: pending.state }) });
}
