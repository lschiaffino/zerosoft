import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { listBlockedSlots, createBlockedSlot } from '@/lib/calendar';
import { blockedSlotCreateSchema } from '@/lib/calendar-schema';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const rows = await listBlockedSlots(realUserId(user));
  return NextResponse.json({ rows });
}

/** El bloqueo es de la persona logueada: listBusyRanges lo aplica a sus reservas en cualquier workspace. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = blockedSlotCreateSchema.safeParse(body);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.message === 'invalid_range')) return crmError(400, 'invalid_range');
    return invalidBody(parsed.error);
  }

  const slot = await createBlockedSlot(realUserId(user), parsed.data);
  return NextResponse.json(slot, { status: 201 });
}
