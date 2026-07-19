import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listBlockedSlots, createBlockedSlot } from '@/lib/calendar';
import { blockedSlotCreateSchema } from '@/lib/calendar-schema';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const rows = await listBlockedSlots(user.id);
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = blockedSlotCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const slot = await createBlockedSlot(user.id, parsed.data);
  return NextResponse.json(slot, { status: 201 });
}
