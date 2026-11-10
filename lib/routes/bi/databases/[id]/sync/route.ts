import type { NextRequest } from 'next/server';
import { withViewer } from '@/lib/bi/http';
import { isBiAdmin } from '@/lib/bi/access';
import { syncDatabase } from '@/lib/bi/run';
import { BiStoreError } from '@/lib/bi/store';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Vuelve a leer tablas y columnas de la base. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'write', async (viewer) => {
    if (!isBiAdmin(viewer)) throw new BiStoreError('admin_only', 403);
    return { tables: await syncDatabase(viewer, id) };
  });
}
