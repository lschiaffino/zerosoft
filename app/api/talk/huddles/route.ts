import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';
import { beatHuddle, getHuddle, joinHuddle, leaveHuddle, listLiveHuddles, signalHuddle } from '@/lib/talk-huddles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ?channelId= → el huddle en vivo de ese canal; sin nada → los huddles en vivo de mis canales. */
export async function GET(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get('channelId');
  return withTalk(async ({ actor }) =>
    NextResponse.json(channelId ? { huddle: await getHuddle(actor, channelId) } : { huddles: await listLiveHuddles(actor) }),
  );
}

const peer = z.string().min(8).max(64);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('join'), channelId: z.string().max(64), peerId: peer }),
  z.object({ action: z.literal('leave'), huddleId: z.string().max(64), peerId: peer }),
  z.object({
    action: z.literal('beat'),
    huddleId: z.string().max(64),
    peerId: peer,
    state: z.object({ muted: z.boolean().optional(), sharing: z.boolean().optional(), video: z.boolean().optional() }).optional(),
  }),
  z.object({ action: z.literal('signal'), huddleId: z.string().max(64), peerId: peer, to: peer, data: z.unknown() }),
]);

/** Entrar, salir, latir (con el estado) y señalización WebRTC entre pestañas. */
export async function POST(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      if (body.action === 'join') return NextResponse.json(await joinHuddle(actor, body.channelId, body.peerId));
      if (body.action === 'leave') {
        await leaveHuddle(actor, body.huddleId, body.peerId);
        return NextResponse.json({ ok: true });
      }
      if (body.action === 'beat') return NextResponse.json({ huddle: await beatHuddle(actor, body.huddleId, body.peerId, body.state ?? {}) });
      await signalHuddle(actor, body.huddleId, body.peerId, body.to, body.data);
      return NextResponse.json({ ok: true });
    },
    { write: 'huddle', limit: 600 },
  );
}
