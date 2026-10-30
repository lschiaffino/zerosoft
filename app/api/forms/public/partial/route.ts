import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIp } from '@/lib/rate-limit';
import { savePartial } from '@/lib/forms/responses';
import { FormsError } from '@/lib/forms/types';
import { formsLimit } from '@/lib/forms/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  slug: z.string().max(62),
  token: z.string().max(64).optional(),
  answers: z.record(z.unknown()),
  hidden: z.record(z.string().max(300)).optional(),
  lang: z.string().max(5).optional(),
  consent: z.literal(true),
});

/** POST: guarda el progreso (respuesta parcial) si el form lo pide y quien responde aceptó. */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const limited = await formsLimit(req, 'partial', 120, 3600, parsed.data.slug);
  if (limited) return limited;
  try {
    const out = await savePartial(parsed.data.slug, parsed.data, { ip: clientIp(req) });
    return NextResponse.json({ token: out?.token ?? null });
  } catch (err) {
    if (err instanceof FormsError) return NextResponse.json({ error: err.code }, { status: err.status });
    throw err;
  }
}
