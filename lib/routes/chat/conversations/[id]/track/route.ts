import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import { ChatTrackError, createIssueFromConversation, linkConversationToIssue, linkedIssues, unlinkIssue } from '@/lib/chat-track';
import { CustomerRequestError } from '@/lib/track-customers';
import { limitWrites } from '@/lib/write-limit';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Issues de Track vinculados a la conversación, con su estado. */
export async function GET(_req: Request, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await canAccessConversation(id, user)).ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ issues: await linkedIssues(id, { teamId: user.team?.id ?? null, ownerId: user.id }) });
}

/** { projectId, title } crea un issue; { identifier } vincula uno existente. */
export async function POST(req: Request, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok, conversation } = await canAccessConversation(id, user);
  if (!ok || !conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const limited = await limitWrites('chat', realUserId(user));
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const base = { conversation, teamId: user.team?.id ?? null, ownerId: user.id, personId: realUserId(user) };
  try {
    const issue =
      typeof body.identifier === 'string'
        ? await linkConversationToIssue({ ...base, identifier: body.identifier })
        : typeof body.projectId === 'string' && typeof body.title === 'string'
          ? await createIssueFromConversation({ ...base, projectId: body.projectId, title: body.title })
          : null;
    if (!issue) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    return NextResponse.json({ issue, issues: await linkedIssues(id, base) }, { status: 201 });
  } catch (err) {
    if (err instanceof ChatTrackError) return NextResponse.json({ error: err.code }, { status: err.status });
    if (err instanceof CustomerRequestError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

/** ?requestId=… saca el vínculo (el issue sigue en Track). */
export async function DELETE(req: Request, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await canAccessConversation(id, user)).ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const requestId = new URL(req.url).searchParams.get('requestId') ?? '';
  if (!requestId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const scope = { teamId: user.team?.id ?? null, ownerId: user.id };
  return (await unlinkIssue(id, requestId, scope))
    ? NextResponse.json({ issues: await linkedIssues(id, scope) })
    : NextResponse.json({ error: 'not_found' }, { status: 404 });
}
