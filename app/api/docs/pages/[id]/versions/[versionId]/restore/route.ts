import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getDocPage, resolveDocAccess } from '@/lib/docs';
import { restoreDocVersion } from '@/lib/docs-versions';
import { docsError, forbidden, notFound, unauthorized } from '@/lib/docs-http';
import { canWriteAccess } from '@/lib/docs-access';
import { logDocsAudit, requestIp } from '@/lib/docs-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const res = await resolveDocAccess(user, id);
  if (!res) return notFound();
  if (!canWriteAccess(res.access)) return forbidden();
  // Bloqueada: primero hay que desbloquearla.
  if (res.row.locked === 1) return docsError(423, 'locked');
  if (!(await restoreDocVersion(res.row.user_id, id, versionId, realUserId(user)))) return notFound();
  await logDocsAudit({
    workspaceId: res.row.user_id,
    actor: user.actingUser ?? user,
    action: 'version.restored',
    page: { id, title: res.row.title },
    detail: versionId,
    ip: requestIp(req.headers),
  });
  return NextResponse.json(await getDocPage(res.row.user_id, id));
}
