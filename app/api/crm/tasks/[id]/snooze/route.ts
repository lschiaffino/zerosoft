import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { canSeeActivity, sessionScope } from '@/lib/crm-visibility';
import { getActivity, updateActivity } from '@/lib/crm';
import { SNOOZE_OPTIONS, snoozeUntil, type SnoozeOption } from '@/lib/crm-work-queue';
import { getUserTimeZone } from '@/lib/user-tz';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ option: z.enum(SNOOZE_OPTIONS as [SnoozeOption, ...SnoozeOption[]]) });

/** Posponer una tarea abierta (cola de trabajo): nueva fecha en la zona de la persona. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await canSeeActivity(user.id, id, await sessionScope(user)))) return notFound();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const task = await getActivity(user.id, id);
  if (!task || task.type !== 'task') return notFound();
  const until = snoozeUntil(parsed.data.option, await getUserTimeZone());
  const dueAt = until.toISOString().slice(0, 19).replace('T', ' ');
  const updated = await updateActivity(user.id, id, { dueAt });
  if (!updated) return notFound();
  return NextResponse.json({ id, due_at: updated.due_at });
}
