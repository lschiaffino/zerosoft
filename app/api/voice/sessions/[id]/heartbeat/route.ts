import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth, readBody } from '@/lib/voice-route';
import { voiceJsonError } from '@/lib/voice-http';
import { getSessionRow, recorderHeartbeat } from '@/lib/voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Latido de la pestaña que graba (cada 30 s). Mantiene el claim de la
 * grabación y le dice al cron que la reunión sigue viva aunque haya silencio.
 * 409 si esta pestaña ya no es la que graba.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'heartbeat', limit: 30 });
  if (auth.res) return auth.res;
  const body = await readBody(req);
  const recorderId = typeof body.recorderId === 'string' ? body.recorderId.slice(0, 64) : '';
  if (!recorderId) return voiceJsonError(400, 'invalid_input');
  const row = await getSessionRow(auth.owner, id);
  if (!row) return voiceJsonError(404, 'not_found');
  if (!(await recorderHeartbeat(id, recorderId))) return voiceJsonError(409, 'not_recorder');
  return NextResponse.json({ ok: true });
}
