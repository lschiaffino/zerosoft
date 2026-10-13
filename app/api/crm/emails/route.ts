import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sendCrmEmailAndSave } from '@/lib/crm-workflows';
import { sendCrmEmailSchema } from '@/lib/crm-workflows-schema';
import { invalidBody, unauthorized, limitAction } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const limited = await limitAction(realUserId(user), 'email', 60, 3600);
  if (limited) return limited;

  const body: unknown = await req.json().catch(() => null);
  const parsed = sendCrmEmailSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const result = await sendCrmEmailAndSave(user.id, {
    ...parsed.data,
    fromEmail: user.actingUser?.email ?? user.email,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'send_failed' }, { status: 400 });
  }
  return NextResponse.json(result, { status: 201 });
}
