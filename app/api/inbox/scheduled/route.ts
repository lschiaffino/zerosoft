import { createScheduled, listScheduled } from '@/lib/inbox/core';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { scheduledCreateSchema } from '@/lib/inbox/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Todos los envíos programados que faltan (o que fallaron), por fecha. */
export async function GET() {
  return withOwner(async (owner) => iJson({ scheduled: await listScheduled(owner) }));
}

export async function POST(req: Request) {
  return withOwner(async (owner) => {
    const body = await parseBody(req, scheduledCreateSchema);
    return iJson({ scheduled: await createScheduled(owner, body.threadId, body.body, body.sendAt) }, 201);
  });
}
