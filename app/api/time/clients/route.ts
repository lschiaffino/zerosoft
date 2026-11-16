import { NextRequest } from 'next/server';
import { createClient, listClients } from '@/lib/time/core';
import { parseBody, tFail, timeActor, timeLimit, tJson } from '@/lib/time/http';
import { namedSchema } from '@/lib/time/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const a = await timeActor();
  if ('res' in a) return a.res;
  return tJson({ clients: await listClients(a.actor) });
}

/** POST: nuevo (solo quien administra). */
export async function POST(req: NextRequest) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  const limited = await timeLimit(req, 'clients', 200, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const body = await parseBody(req, namedSchema);
    return tJson({ item: await createClient(a.actor, body.name ?? '') }, 201);
  } catch (err) {
    return tFail(err);
  }
}
