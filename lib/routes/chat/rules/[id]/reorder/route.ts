import { NextResponse } from 'next/server';
import { canAccessWidget } from '@/lib/chat-access';
import { getCurrentUser } from '@/lib/session';
import { getAssignmentRule, getChatWidget, reorderAssignmentRules } from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rule = await getAssignmentRule(params.id);
  if (!rule) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const widget = await getChatWidget(rule.widget_id);
  if (!widget) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!canAccessWidget(widget, user)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const orderedIds = Array.isArray(body.orderedIds)
    ? body.orderedIds.filter((id): id is string => typeof id === 'string')
    : [];

  if (orderedIds.length === 0) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  await reorderAssignmentRules(rule.widget_id, orderedIds);
  return NextResponse.json({ ok: true });
}
