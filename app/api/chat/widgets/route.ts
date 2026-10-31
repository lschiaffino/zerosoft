import { NextResponse } from 'next/server';
import { listAccessibleChatWidgets } from '@/lib/chat-access';
import { getCurrentUser } from '@/lib/session';
import { createChatWidget } from '@/lib/chat-data';
import { widgetCreateSchema } from '@/lib/chat-schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const widgets = await listAccessibleChatWidgets(user);
  return NextResponse.json({ widgets });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const parsed = widgetCreateSchema.safeParse(raw);
  if (!parsed.success) {
    const nameIssue = parsed.error.issues.some((i) => i.path[0] === 'name');
    return NextResponse.json({ error: nameIssue ? 'missing_name' : 'invalid_input' }, { status: 400 });
  }

  const widget = await createChatWidget(user.id, user.team?.id ?? null, parsed.data);
  return NextResponse.json(widget, { status: 201 });
}
