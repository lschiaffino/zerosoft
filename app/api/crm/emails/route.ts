import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sendCrmEmailAndSave } from '@/lib/crm-workflows';
import { sendCrmEmailSchema } from '@/lib/crm-workflows-schema';
import { threadReplyInfo } from '@/lib/crm-email';
import { invalidBody, unauthorized, limitAction } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Envía un email desde el timeline: como el usuario vía su Gmail (si lo
 * conectó con permiso de envío) o, si no, con el envío del sistema.
 * Con threadId responde dentro de ese thread.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const limited = await limitAction(realUserId(user), 'email', 60, 3600);
  if (limited) return limited;

  const body: unknown = await req.json().catch(() => null);
  const parsed = sendCrmEmailSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const reply = parsed.data.threadId ? await threadReplyInfo(user.id, parsed.data.threadId) : null;
  if (parsed.data.threadId && !reply) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const result = await sendCrmEmailAndSave(user.id, {
    ...parsed.data,
    fromEmail: user.actingUser?.email ?? user.email,
    senderId: realUserId(user),
    threadId: reply?.threadId ?? null,
    inReplyTo: reply?.inReplyTo || null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'send_failed' }, { status: 400 });
  }
  return NextResponse.json(result, { status: 201 });
}
