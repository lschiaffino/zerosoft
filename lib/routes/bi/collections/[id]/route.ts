import type { NextRequest } from 'next/server';
import { withViewer } from '@/lib/bi/http';
import { deleteCollection, updateCollection } from '@/lib/bi/store';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Renombra una colección. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'write', (viewer, body) => updateCollection(viewer, id, { name: body.name }));
}

/** Borra una colección; lo que tenía sube un nivel. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'write', async (viewer) => {
    await deleteCollection(viewer, id);
    return { ok: true };
  });
}
