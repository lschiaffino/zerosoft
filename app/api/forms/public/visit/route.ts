import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { trackVisit } from '@/lib/forms/responses';
import { formsLimit } from '@/lib/forms/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ slug: z.string().max(62), visit: z.string().max(40), question: z.string().max(40).nullish() });

/** POST: la visita llegó a una pregunta (para el abandono). Sin respuestas ni IP guardada. */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const limited = await formsLimit(req, 'visit', 600, 3600);
  if (limited) return NextResponse.json({ ok: false }, { status: 202 });
  await trackVisit(parsed.data.slug, parsed.data.visit, parsed.data.question ?? null).catch(() => null);
  return NextResponse.json({ ok: true });
}
