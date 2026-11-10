import type { NextRequest } from 'next/server';
import { withViewer } from '@/lib/bi/http';
import { deleteSubscription } from '@/lib/bi/subscriptions';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'write', async (viewer) => {
    await deleteSubscription(viewer, id);
    return { ok: true };
  });
}
