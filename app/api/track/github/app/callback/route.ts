import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { trackWorkspaceId } from '@/lib/track-labels';
import { saveGithubInstallation } from '@/lib/track-github';
import { verifyInstallationAccess } from '@/lib/track-github-app';
import { verifyOAuthState } from '@/lib/track-integrations';
import { recordAudit } from '@/lib/track-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function back(req: Request, status: string): NextResponse {
  return NextResponse.redirect(new URL(`/app/track/settings?tab=github&github=${status}`, req.url));
}

/**
 * Vuelta de GitHub después de instalar la App. Ata la instalación al
 * workspace solo si el state es de esta sesión y el code de OAuth confirma
 * que la persona tiene acceso a esa instalación.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL('/app', req.url));
  if (!isWorkspaceAdmin(user)) return back(req, 'forbidden');
  const state = verifyOAuthState(url.searchParams.get('state'));
  const workspaceId = trackWorkspaceId(user.team?.id ?? null, user.id);
  if (!state || state.workspaceId !== workspaceId || state.personId !== realUserId(user)) return back(req, 'invalid_state');
  const installationId = Number(url.searchParams.get('installation_id'));
  const code = url.searchParams.get('code');
  if (!Number.isInteger(installationId) || installationId <= 0 || !code) return back(req, 'missing_code');
  const access = await verifyInstallationAccess(code, installationId).catch(() => null);
  if (!access) return back(req, 'not_allowed');
  await saveGithubInstallation(workspaceId, user.id, installationId, access.accountLogin || null);
  await recordAudit({
    workspaceId,
    actorId: realUserId(user),
    action: 'integration.connected',
    entityType: 'integration',
    entityLabel: `GitHub App (${access.accountLogin || installationId})`,
  });
  return back(req, 'installed');
}
