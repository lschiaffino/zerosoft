import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createAssignmentRule, getChatWidget, isChatAgentOfWidget, listAssignmentRules } from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

function canAccess(widget: Awaited<ReturnType<typeof getChatWidget>>, user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  if (!widget) return false;
  if (widget.user_id === user.id) return true;
  if (widget.team_id && user.team?.id === widget.team_id) return true;
  return false;
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const widget = await getChatWidget(params.id);
  if (!canAccess(widget, user)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const rules = await listAssignmentRules(params.id);
  return NextResponse.json({ rules });
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const widget = await getChatWidget(params.id);
  if (!canAccess(widget, user)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const matchType = body.matchType;
  if (
    !name ||
    (matchType !== 'all' &&
      matchType !== 'keyword' &&
      matchType !== 'time' &&
      matchType !== 'round_robin')
  ) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const assignTo = typeof body.assignTo === 'string' && body.assignTo ? body.assignTo : null;
  if (assignTo && !(await isChatAgentOfWidget(widget!, assignTo))) {
    return NextResponse.json({ error: 'invalid_assignee' }, { status: 400 });
  }

  const rule = await createAssignmentRule(params.id, {
    name,
    matchType,
    matchValue: typeof body.matchValue === 'string' ? body.matchValue : null,
    assignTo,
    position: typeof body.position === 'number' ? body.position : undefined,
    active: typeof body.active === 'boolean' ? body.active : undefined,
  });

  return NextResponse.json(rule, { status: 201 });
}
