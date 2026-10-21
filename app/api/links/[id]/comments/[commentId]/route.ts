import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { getLinkForViewer } from '@/lib/links';
import { viewerOf } from '@/lib/link-folders';
import { deleteLinkComment } from '@/lib/link-comments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string; commentId: string }> }) {
  const { id, commentId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const found = await getLinkForViewer(user.id, id, viewerOf(user), 'view');
  if ('status' in found) {
    return NextResponse.json({ error: found.status === 403 ? 'forbidden' : 'not_found' }, { status: found.status });
  }
  const { link } = found;
  const result = await deleteLinkComment(link.id, commentId, realUserId(user), isWorkspaceAdmin(user));
  if (result === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (result === 'forbidden') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return new NextResponse(null, { status: 204 });
}
