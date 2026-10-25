import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { trackRecView } from '@/lib/rec';
import { publicVideoFor, resolveViewer, withViewerCookie } from '@/lib/rec-http';
import { clientIp, limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  viewId: z.string().uuid().optional(),
  watched: z.number().min(0).max(86_400).optional(),
  position: z.number().min(0).max(86_400).optional(),
  duration: z.number().min(0).max(86_400).optional(),
  cta: z.boolean().optional(),
  name: z.string().max(80).optional(),
});

/** Pings del reproductor (también por sendBeacon al cerrar): abre la vista y suma lo visto. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ share: string }> }) {
  const limited = await limitByIp(req, 'rec:track', 300, 600);
  if (limited) return limited;
  const { share } = await ctx.params;
  const r = await publicVideoFor(req, share);
  if ('res' in r) return r.res;
  let body: unknown = null;
  try {
    body = JSON.parse(await req.text());
  } catch {
    body = null;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { viewer, newKey } = await resolveViewer(req, r.v, parsed.data.name);
  const out = await trackRecView(r.v, viewer, { ...parsed.data, ip: clientIp(req), userAgent: req.headers.get('user-agent') ?? '' });
  return withViewerCookie(NextResponse.json(out), newKey);
}
