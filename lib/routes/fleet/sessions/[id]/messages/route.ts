import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fJson, limit, parseBody, withFleet } from '@/lib/fleet/api';
import { queueReply } from '@/lib/fleet/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { text }: deja una respuesta en cola; la entrega el Stop hook del agente. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withFleet(async ({ actor }) => {
    const limited = await limit(`reply:${actor.person}`, 60, 60);
    if (limited) return limited;
    const { id } = await ctx.params;
    const { text } = await parseBody(req, z.object({ text: z.string().min(1).max(8000) }));
    return fJson({ message: await queueReply(actor, id, text, 'web') }, 201);
  });
}
