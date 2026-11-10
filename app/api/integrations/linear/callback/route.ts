import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { trackWorkspaceId } from '@/lib/track-labels';
import { verifyOAuthState } from '@/lib/track-integrations';
import { connectLinear, exchangeLinearCode, linearOAuthConfigured } from '@/lib/track-linear-sync';
import { recordAudit } from '@/lib/track-audit';
import { requestLocale } from '@/lib/request-locale';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function back(req: Request, status: string): NextResponse {
  return NextResponse.redirect(new URL(`/app/track/settings?tab=integrations&linear=${status}`, req.url));
}

/**
 * Vuelta de "Login with Linear": el state está firmado para este workspace y
 * esta persona (vence en 15 minutos); el token se guarda cifrado.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL('/app', req.url));
  if (!isWorkspaceAdmin(user)) return back(req, 'forbidden');
  if (!linearOAuthConfigured()) return back(req, 'not_configured');
  if (url.searchParams.get('error')) return back(req, 'denied');
  const state = verifyOAuthState(url.searchParams.get('state'));
  const workspaceId = trackWorkspaceId(user.team?.id ?? null, user.id);
  if (!state || state.workspaceId !== workspaceId || state.personId !== realUserId(user)) return back(req, 'invalid_state');
  const code = url.searchParams.get('code');
  if (!code || code.length > 500) return back(req, 'denied');
  try {
    const t = await exchangeLinearCode(code);
    const conn = await connectLinear(
      {
        workspaceId,
        jobWorkspaceId: user.id,
        jobTeamId: user.team?.id ?? null,
        personId: realUserId(user),
        locale: requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language')),
      },
      { type: 'oauth', token: t.token, refreshToken: t.refreshToken, expiresAt: t.expiresAt },
    );
    await recordAudit({ workspaceId, actorId: realUserId(user), action: 'integration.connected', entityType: 'integration', entityLabel: `Linear (${conn.config.orgName})` });
    return back(req, 'connected');
  } catch {
    return back(req, 'failed');
  }
}
