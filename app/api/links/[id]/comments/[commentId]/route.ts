import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { getUserLink } from '@/lib/links';
import { deleteLinkComment } from '@/lib/link-comments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string; commentId: string }> }) {
  const { id, commentId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const link = await getUserLink(user.id, id);
  if (!link) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const result = await deleteLinkComment(link.id, commentId, realUserId(user), isWorkspaceAdmin(user));
  if (result === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (result === 'forbidden') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return new NextResponse(null, { status: 204 });
}
