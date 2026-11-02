import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createSpace, listSpaces } from '@/lib/send/spaces';
import { parseBody, sendActor, sendLimit, sFail, sJson } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  return sJson({ spaces: await listSpaces(a.actor, req.nextUrl.searchParams.get('q') ?? '') });
}

const schema = z.object({ title: z.string().trim().min(1).max(200) });

export async function POST(req: NextRequest) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  const limited = await sendLimit(req, 'space', 120, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const s = await createSpace(a.actor, (await parseBody(req, schema)).title);
    return sJson({ space: { id: s.id, title: s.title } }, 201);
  } catch (err) {
    return sFail(err);
  }
}
