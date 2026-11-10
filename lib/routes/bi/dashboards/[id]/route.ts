import type { NextRequest } from 'next/server';
import { withViewer } from '@/lib/bi/http';
import { BiStoreError, deleteDashboard, getDashboard, updateDashboard } from '@/lib/bi/store';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'read', async (viewer) => {
    const dashboard = await getDashboard(viewer, id);
    if (!dashboard) throw new BiStoreError('not_found', 404);
    return { dashboard };
  });
}

/** Renombra, mueve, cambia filtros, auto-refresh o la grilla de tarjetas. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'write', async (viewer, body) => ({ dashboard: await updateDashboard(viewer, id, body) }));
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'write', async (viewer) => {
    await deleteDashboard(viewer, id);
    return { ok: true };
  });
}
