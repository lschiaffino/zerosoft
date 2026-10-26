import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { toggleReaction } from '@/lib/talk';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ emoji: z.string().min(1).max(16), on: z.boolean().optional() });

/** Pone o saca una reacción (sin `on`, alterna). */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json(await toggleReaction(actor, id, body.emoji, body.on));
    },
    { write: 'reactions', limit: 240 },
  );
}
