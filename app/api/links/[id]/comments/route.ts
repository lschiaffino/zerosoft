import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getLinkForViewer } from '@/lib/links';
import { viewerOf } from '@/lib/link-folders';
import { addLinkComment, linkCommentSchema, listLinkComments } from '@/lib/link-comments';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const found = await getLinkForViewer(user.id, id, viewerOf(user), 'view');
  if ('status' in found) {
    return NextResponse.json({ error: found.status === 403 ? 'forbidden' : 'not_found' }, { status: found.status });
  }
  const { link } = found;
  return NextResponse.json({ comments: await listLinkComments(link.id) });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const limited = await limitByIp(req, 'link-comment', 60, 60);
  if (limited) return limited;
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const found = await getLinkForViewer(user.id, id, viewerOf(user), 'view');
  if ('status' in found) {
    return NextResponse.json({ error: found.status === 403 ? 'forbidden' : 'not_found' }, { status: found.status });
  }
  const { link } = found;
  const parsed = linkCommentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  return NextResponse.json(await addLinkComment(link.id, realUserId(user), parsed.data.body), { status: 201 });
}
