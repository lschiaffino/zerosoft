import { NextRequest } from 'next/server';
import { createTask, listTasks } from '@/lib/time/core';
import { parseBody, tFail, timeActor, timeLimit, tJson } from '@/lib/time/http';
import { namedSchema } from '@/lib/time/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const a = await timeActor();
  if ('res' in a) return a.res;
  return tJson({ tasks: await listTasks(a.actor) });
}

/** POST: nuevo (solo quien administra). */
export async function POST(req: NextRequest) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  const limited = await timeLimit(req, 'tasks', 200, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const body = await parseBody(req, namedSchema);
    return tJson({ item: await createTask(a.actor, { name: body.name ?? '', billable: body.billable }) }, 201);
  } catch (err) {
    return tFail(err);
  }
}
