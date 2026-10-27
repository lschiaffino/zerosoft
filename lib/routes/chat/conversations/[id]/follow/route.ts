import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import { isFollowing, listFollowers, setFollowing } from '@/lib/chat-collab';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await canAccessConversation(id, user)).ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ following: await isFollowing(id, realUserId(user)), followers: (await listFollowers(id)).length });
}

/** { follow: boolean } */
export async function POST(req: Request, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await canAccessConversation(id, user)).ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { follow?: unknown } | null;
  if (!body || typeof body.follow !== 'boolean') return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const following = await setFollowing(id, realUserId(user), body.follow);
  return NextResponse.json({ following, followers: (await listFollowers(id)).length });
}
