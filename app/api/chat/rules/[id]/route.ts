import { NextResponse } from 'next/server';
import { canAccessWidget } from '@/lib/chat-access';
import { getCurrentUser } from '@/lib/session';
import {
  deleteAssignmentRule,
  getAssignmentRule,
  getChatWidget,
  updateAssignmentRule,
} from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

async function canAccessRule(
  ruleId: string,
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
) {
  const rule = await getAssignmentRule(ruleId);
  if (!rule) return { ok: false, rule: null };
  const widget = await getChatWidget(rule.widget_id);
  if (!widget) return { ok: false, rule: null };
  if (!canAccessWidget(widget, user)) {
    return { ok: false, rule: null };
  }
  return { ok: true, rule };
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok, rule } = await canAccessRule(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(rule);
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok } = await canAccessRule(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const matchType = body.matchType;
  const updated = await updateAssignmentRule(params.id, {
    name: typeof body.name === 'string' ? body.name : undefined,
    matchType:
      matchType === 'all' ||
      matchType === 'keyword' ||
      matchType === 'time' ||
      matchType === 'round_robin'
        ? matchType
        : undefined,
    matchValue: typeof body.matchValue === 'string' ? body.matchValue : undefined,
    assignTo: body.assignTo === null ? null : typeof body.assignTo === 'string' ? body.assignTo : undefined,
    position: typeof body.position === 'number' ? body.position : undefined,
    active: typeof body.active === 'boolean' ? body.active : undefined,
  });

  if (!updated) return NextResponse.json({ error: 'generic' }, { status: 500 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok } = await canAccessRule(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await deleteAssignmentRule(params.id);
  return NextResponse.json({ ok: true });
}
