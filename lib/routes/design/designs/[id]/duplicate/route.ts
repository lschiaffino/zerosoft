import { NextRequest } from 'next/server';
import { z } from 'zod';
import { duplicateDesign, getDesign } from '@/lib/design';
import { designActor, designFail, designJson } from '@/lib/design-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Copia privada del diseño para quien duplica. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const s = await designActor({ write: true });
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = z.object({ name: z.string().max(120).optional() }).safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return designJson({ error: 'invalid_input' }, 400);
  try {
    const copy = await duplicateDesign(s.actor, id, parsed.data.name);
    return designJson({ design: await getDesign(s.actor, copy) }, 201);
  } catch (err) {
    return designFail(err);
  }
}
