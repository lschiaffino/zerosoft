import { NextRequest } from 'next/server';
import { z } from 'zod';
import { addNote } from '@/lib/hiring/candidates';
import { hFail, hiringActor, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { body }: nota interna en la línea de tiempo. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    const { body } = await parseBody(req, z.object({ body: z.string().min(1).max(10_000) }));
    await addNote(a.actor, (await params).id, body);
    return hJson({ ok: true }, 201);
  } catch (err) {
    return hFail(err);
  }
}
