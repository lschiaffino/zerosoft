import { createScheduled, listScheduled } from '@/lib/inbox/core';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { createBatch } from '@/lib/inbox/schedule';
import { scheduledCreateSchema } from '@/lib/inbox/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Todos los envíos programados que faltan (o que fallaron), por fecha. */
export async function GET() {
  return withOwner(async (owner) => iJson({ scheduled: await listScheduled(owner) }));
}

/**
 * Programa un envío: varios mensajes (`parts`, cada uno su burbuja, con
 * espera y archivo opcionales; `key` evita duplicarlo) o uno solo (`body`).
 */
export async function POST(req: Request) {
  return withOwner(async (owner) => {
    const body = await parseBody(req, scheduledCreateSchema);
    if ('parts' in body) return iJson({ scheduled: await createBatch(owner, body) }, 201);
    return iJson({ scheduled: await createScheduled(owner, body.threadId, body.body, body.sendAt) }, 201);
  });
}
