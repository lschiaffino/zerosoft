import { NextRequest } from 'next/server';
import { z } from 'zod';
import { sendRecap } from '@/lib/rec-admin';
import { getVideoRow } from '@/lib/rec';
import { recActor, recFail, recJson } from '@/lib/rec-http';
import { recShareUrl } from '@/lib/rec-page';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ emails: z.array(z.string().max(254)).min(1).max(40), locale: z.enum(['en', 'es', 'pt']).optional() });

/** Manda el resumen del video por mail (solo quien lo administra). Con tope y sin repetir. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  try {
    const v = await getVideoRow(s.actor, id);
    if (!v) return recJson({ error: 'not_found' }, 404);
    return recJson(await sendRecap(s.actor, id, parsed.data.emails, recShareUrl(parsed.data.locale ?? 'en', v.share_id)));
  } catch (err) {
    return recFail(err);
  }
}
