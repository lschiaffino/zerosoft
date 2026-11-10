import { NextResponse } from 'next/server';
import { getMessageRow } from '@/lib/groups';
import { chatGuard, groupsError, groupsSession } from '@/lib/groups-http';
import { linesTranscript } from '@/lib/groups-transcript';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function handle(ctx: Ctx, start: boolean) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const msg = await getMessageRow(s.ws, id);
  if (!msg) return groupsError(404, 'not_found');
  const guard = await chatGuard(s, msg.chat_id);
  if (guard instanceof NextResponse) return guard;
  const t = await linesTranscript(s.ws, id, start);
  if (t === 'not_audio') return groupsError(400, 'invalid_input');
  return NextResponse.json({ transcript: t }, { headers: { 'cache-control': 'private, no-store' } });
}

/** La transcripción guardada de un audio del chat ({ transcript: null } si todavía no se hizo). */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(ctx, false);
}

/** Transcribe el audio (una sola vez por workspace; los largos con resumen). */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(ctx, true);
}
