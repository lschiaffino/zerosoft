import type { NextRequest } from 'next/server';
import { withViewer } from '@/lib/bi/http';
import { revokeShare } from '@/lib/bi/store';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Desactiva un link público. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'write', async (viewer) => {
    await revokeShare(viewer, id);
    return { ok: true };
  });
}
