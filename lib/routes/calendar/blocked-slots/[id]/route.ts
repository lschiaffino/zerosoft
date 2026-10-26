import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { CalendarError, getBlockedSlot, updateBlockedSlot, deleteBlockedSlot } from '@/lib/calendar';
import { blockedSlotUpdateSchema } from '@/lib/calendar-schema';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const slot = await getBlockedSlot(realUserId(user), params.id);
  if (!slot) return notFound();
  return NextResponse.json(slot);
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = blockedSlotUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    const slot = await updateBlockedSlot(realUserId(user), params.id, parsed.data);
    if (!slot) return notFound();
    return NextResponse.json(slot);
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    throw err;
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await deleteBlockedSlot(realUserId(user), params.id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
