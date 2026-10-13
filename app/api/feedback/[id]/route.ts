import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { FEEDBACK_STATUSES, isAdminEmail, setFeedbackStatus } from '@/lib/feedback';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({ status: z.enum(FEEDBACK_STATUSES) });

// Solo ADMIN_EMAILS; para el resto la ruta no existe.
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!isAdminEmail(user?.actingUser?.email ?? user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const ok = await setFeedbackStatus(id, parsed.data.status);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
