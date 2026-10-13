import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteSchedule, getSchedule, ScheduleError, updateSchedule } from '@/lib/calendar-schedules';
import { scheduleUpdateSchema } from '@/lib/calendar-schema';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const schedule = await getSchedule(user.id, id);
  return schedule ? NextResponse.json(schedule) : notFound();
}

/** Cambia nombre, zona, horas semanales (reemplazo) y excepciones por fecha (reemplazo). */
export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = scheduleUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const schedule = await updateSchedule(user.id, id, parsed.data);
  return schedule ? NextResponse.json(schedule) : notFound();
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  try {
    if (!(await deleteSchedule(user.id, id))) return notFound();
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof ScheduleError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
