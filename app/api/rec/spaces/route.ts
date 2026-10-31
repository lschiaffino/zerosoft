import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createSpace, listSpaces } from '@/lib/rec-admin';
import { recActor, recFail, recJson } from '@/lib/rec-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const s = await recActor();
  if ('res' in s) return s.res;
  return recJson({ spaces: await listSpaces(s.actor) });
}

export async function POST(req: NextRequest) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const parsed = z.object({ name: z.string().max(120) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  try {
    return recJson({ space: await createSpace(s.actor, parsed.data.name) }, 201);
  } catch (err) {
    return recFail(err);
  }
}
