import { NextRequest } from 'next/server';
import { fJson, withFleet } from '@/lib/fleet/api';
import { cancelReply } from '@/lib/fleet/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE: saca de la cola una respuesta que todavía no se entregó. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; messageId: string }> }) {
  return withFleet(async ({ actor }) => {
    const { id, messageId } = await ctx.params;
    await cancelReply(actor, id, messageId);
    return fJson({ ok: true });
  });
}
