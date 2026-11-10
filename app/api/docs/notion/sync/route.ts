import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, userCanUseApp } from '@/lib/session';
import { docsError, forbidden, unauthorized } from '@/lib/docs-http';
import { rateLimit } from '@/lib/rate-limit';
import { isAdminEmail } from '@/lib/feedback';
import { getNotionSyncStatus, syncNotionNow } from '@/lib/notion-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * "Sincronizar ahora": una vuelta corta (unos segundos) con el mismo claim
 * que el cron. La pantalla la llama seguido mientras dura el import inicial.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!userCanUseApp(user, 'docs') || !isWorkspaceAdmin(user)) return forbidden();
  const limit = await rateLimit(`notion-sync-now:${user.id}`, 60, 60);
  if (!limit.ok) return docsError(429, 'rate_limited');
  const ran = await syncNotionNow(user.id, 8_000);
  return NextResponse.json({ ran, ...(await getNotionSyncStatus(user.id, { operator: isAdminEmail((user.actingUser ?? user).email) })) });
}
