import { NextRequest, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { getEventTypeById, getAvailableSlots } from '@/lib/calendar';
import { notFound, crmError } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const limited = await limitByIp(_req, 'slots', 120, 60);
  if (limited) return limited;
  try {
    const eventType = await getEventTypeById(params.id);
    if (!eventType || eventType.active !== 1) return notFound();

    const { searchParams } = new URL(_req.url);
    const date = searchParams.get('date') ?? '';
    const timezone = searchParams.get('timezone') ?? 'UTC';

    const slots = await getAvailableSlots(params.id, timezone, date);
    return NextResponse.json({
      slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
    });
  } catch {
    return crmError(500, 'generic');
  }
}
