import { NextRequest } from 'next/server';
import { z } from 'zod';
import { recordPing, requireViewer } from '@/lib/send/viewer';
import { publicLink, sendLimit, sFail, sJson, type PublicCtx } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  documentId: z.string().max(40),
  versionId: z.string().max(40),
  webdriver: z.boolean().optional(),
  deltas: z.array(z.object({ page: z.number().int().min(1).max(10_000), seconds: z.number().min(0).max(3600) })).max(100),
});

/** POST: segundos por página desde el aviso anterior. Con el link cortado responde 410 y el visor se cierra. */
export async function POST(req: NextRequest, ctx: PublicCtx) {
  const p = await publicLink(req, (await ctx.params).token);
  if ('res' in p) return p.res;
  const limited = await sendLimit(req, 'ping', 240, 60);
  if (limited) return limited;
  try {
    const session = await requireViewer(p.link, p.cookie);
    // sendBeacon manda text/plain: el cuerpo se lee como JSON igual.
    const parsed = schema.safeParse(JSON.parse(await req.text()));
    if (!parsed.success) return sJson({ error: 'invalid_input' }, 400);
    const res = await recordPing(p.link, session, parsed.data, { headers: req.headers, ua: req.headers.get('user-agent') ?? '' });
    return sJson({ ok: true, counted: res.visitId !== null });
  } catch (err) {
    if (err instanceof SyntaxError) return sJson({ error: 'invalid_input' }, 400);
    return sFail(err);
  }
}
