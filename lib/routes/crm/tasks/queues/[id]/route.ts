import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteQueue, getQueue, sessionQueueViewer, updateQueue, type QueueWriteError } from '@/lib/crm-task-queues';
import { taskQueueUpdateSchema } from '@/lib/crm-schema';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function writeError(error: QueueWriteError): NextResponse {
  if (error === 'not_found') return notFound();
  return crmError(error === 'forbidden' ? 403 : 400, error);
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const queue = await getQueue(sessionQueueViewer(user), id);
  return queue ? NextResponse.json(queue) : notFound();
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = taskQueueUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const out = await updateQueue(sessionQueueViewer(user), id, parsed.data);
  return out.ok ? NextResponse.json(out.queue) : writeError(out.error);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const out = await deleteQueue(sessionQueueViewer(user), id);
  return out.ok ? new NextResponse(null, { status: 204 }) : writeError(out.error);
}
