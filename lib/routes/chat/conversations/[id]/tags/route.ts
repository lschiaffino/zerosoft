import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import { addConversationTag, listConversationTags, normalizeTag, removeConversationTag } from '@/lib/chat-inbox';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function guard(props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  const { ok } = await canAccessConversation(id, user);
  if (!ok) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  return { id };
}

export async function GET(_req: Request, props: Ctx) {
  const g = await guard(props);
  if ('error' in g) return g.error;
  return NextResponse.json({ tags: await listConversationTags(g.id) });
}

export async function POST(req: Request, props: Ctx) {
  const g = await guard(props);
  if ('error' in g) return g.error;
  const body = (await req.json().catch(() => null)) as { tag?: unknown } | null;
  const tag = typeof body?.tag === 'string' ? normalizeTag(body.tag) : '';
  if (!tag) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  return NextResponse.json({ tags: await addConversationTag(g.id, tag) }, { status: 201 });
}

export async function DELETE(req: Request, props: Ctx) {
  const g = await guard(props);
  if ('error' in g) return g.error;
  const tag = new URL(req.url).searchParams.get('tag') ?? '';
  if (!tag) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  return NextResponse.json({ tags: await removeConversationTag(g.id, tag) });
}
