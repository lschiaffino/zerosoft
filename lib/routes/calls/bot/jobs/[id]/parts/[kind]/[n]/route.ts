import { NextRequest } from 'next/server';
import { authBot, storeBotPart } from '@/lib/calls/bot';
import { callsLimit, cFail, cJson } from '@/lib/calls/http';
import { PART_BYTES } from '@/lib/calls/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PUT: una parte de la grabación del bot. kind=video: 4 MB exactos del MP4
 * (la última, menos). kind=audio: un segmento entero para transcribir, con
 * x-segment-start-ms.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string; kind: string; n: string }> }) {
  const limited = await callsLimit(req, 'bot-part', 2400, 60);
  if (limited) return limited;
  const { id, kind, n } = await ctx.params;
  if (kind !== 'video' && kind !== 'audio') return cJson({ error: 'not_found' }, 404);
  if (!/^\d{1,4}$/.test(n)) return cJson({ error: 'invalid_part' }, 400);
  const row = await authBot(req, id);
  if (!row) return cJson({ error: 'unauthorized' }, 401);
  if (Number(req.headers.get('content-length') ?? 0) > PART_BYTES) return cJson({ error: 'invalid_part' }, 413);
  try {
    const bytes = Buffer.from(await req.arrayBuffer());
    const startMs = Number(req.headers.get('x-segment-start-ms') ?? 0);
    await storeBotPart(row, kind, Number(n), bytes, req.headers.get('content-type') ?? '', Number.isFinite(startMs) ? startMs : 0);
    return cJson({ ok: true });
  } catch (err) {
    return cFail(err);
  }
}
