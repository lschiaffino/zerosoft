import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getChatWidget, listSlaPolicies, upsertSlaPolicy } from '@/lib/chat-data';
import { slaPoliciesUpdateSchema } from '@/lib/chat-schema';

import { canAccessWidget } from '@/lib/chat-access';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const widget = await getChatWidget(params.id);
  if (!await canAccessWidget(widget, user)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const policies = await listSlaPolicies(params.id);
  return NextResponse.json({ policies });
}

export async function PUT(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const widget = await getChatWidget(params.id);
  if (!await canAccessWidget(widget, user)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const parsed = slaPoliciesUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const policies = [];
  for (const policy of parsed.data.policies) {
    policies.push(await upsertSlaPolicy(params.id, policy));
  }
  return NextResponse.json({ policies });
}
