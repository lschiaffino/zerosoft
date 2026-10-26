import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { trackDocumentView } from '@/lib/crm-media';
import { clientIp, limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  viewId: z.string().uuid().optional(),
  seconds: z.number().min(0).max(86_400).optional(),
  pages: z.record(z.number().min(0).max(86_400)).optional(),
  pageCount: z.number().int().min(0).max(2000).optional(),
});

/** Pings del visor de documentos (también por sendBeacon al cerrar la pestaña). */
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const limited = await limitByIp(req, 'crm:doc-track', 240, 600);
  if (limited) return limited;
  const raw = await req.text();
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const res = await trackDocumentView(token, {
    ...parsed.data,
    ip: clientIp(req),
    userAgent: req.headers.get('user-agent') ?? '',
  });
  if (!res) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(res);
}
