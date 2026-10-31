import { NextRequest } from 'next/server';
import { z } from 'zod';
import { transferContent } from '@/lib/rec-admin';
import { recActor, recFail, recJson, recPeople } from '@/lib/rec-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pasa los videos y carpetas de una persona a otra del workspace. Solo admins. */
export async function POST(req: NextRequest) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const parsed = z.object({ from: z.string().max(60), to: z.string().max(60) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  try {
    const people = await recPeople(s.user);
    return recJson(await transferContent(s.actor, parsed.data.from, parsed.data.to, people.map((p) => p.id)));
  } catch (err) {
    return recFail(err);
  }
}
