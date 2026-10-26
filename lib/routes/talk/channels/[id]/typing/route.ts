import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { emitTalkEvent, readableChannel } from '@/lib/talk';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ parentId: z.string().max(64).nullable().optional() });

/** "Está escribiendo…": un evento efímero para quienes miran el canal. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const body = (await readBody(req, schema)) ?? {};
      const access = await readableChannel(actor, id);
      if (!access?.member) return jsonError(404, 'not_found');
      await emitTalkEvent(actor.workspaceId, 'typing', { channelId: id, actorId: actor.personId, payload: { userId: actor.personId, parentId: body.parentId ?? null } });
      return NextResponse.json({ ok: true });
    },
    { write: 'typing', limit: 60 },
  );
}
