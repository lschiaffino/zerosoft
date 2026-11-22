import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { createQueue, listQueues, sessionQueueViewer } from '@/lib/crm-task-queues';
import { openCountsByQueue } from '@/lib/crm-tasks-index';
import { taskQueueCreateSchema } from '@/lib/crm-schema';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';
import { getUserTimeZone } from '@/lib/user-tz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Colas de tareas que la persona ve, con sus tareas abiertas (las que ve). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const viewer = sessionQueueViewer(user);
  const [rows, counts] = await Promise.all([
    listQueues(viewer),
    openCountsByQueue({ workspaceId: user.id, viewer, ownerScope: await sessionScope(user), timeZone: await getUserTimeZone() }),
  ]);
  return NextResponse.json({ rows: rows.map((q) => ({ ...q, openCount: counts.get(q.id) ?? 0 })) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = taskQueueCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const out = await createQueue(sessionQueueViewer(user), parsed.data);
  if (!out.ok) return crmError(400, out.error);
  return NextResponse.json(out.queue, { status: 201 });
}
