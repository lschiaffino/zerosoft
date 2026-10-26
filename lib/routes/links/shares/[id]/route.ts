import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { getLinkForViewer } from '@/lib/links';
import { viewerOf } from '@/lib/link-folders';
import { getShare, revokeShare } from '@/lib/link-shares';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Revoca una página pública: admins, quien la creó o quien puede editar el link. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const share = await getShare(user.id, id);
  if (!share || share.revoked_at) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  let allowed = isWorkspaceAdmin(user) || share.created_by === realUserId(user);
  if (!allowed && share.link_id) {
    allowed = !('status' in (await getLinkForViewer(user.id, share.link_id, viewerOf(user), 'edit')));
  }
  if (!allowed) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await revokeShare(user.id, id);
  return new NextResponse(null, { status: 204 });
}
