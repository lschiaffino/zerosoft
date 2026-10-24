import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { trackVideoView } from '@/lib/crm-media';
import { clientIp, limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  viewId: z.string().uuid().optional(),
  watched: z.number().min(0).max(86_400).optional(),
  position: z.number().min(0).max(86_400).optional(),
  duration: z.number().min(0).max(86_400).optional(),
});

/** Pings del reproductor de videos 1:1 (también por sendBeacon al cerrar). */
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const limited = await limitByIp(req, 'crm:video-track', 240, 600);
  if (limited) return limited;
  let body: unknown = null;
  try {
    body = JSON.parse(await req.text());
  } catch {
    body = null;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const res = await trackVideoView(token, { ...parsed.data, ip: clientIp(req), userAgent: req.headers.get('user-agent') ?? '' });
  if (!res) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(res);
}
