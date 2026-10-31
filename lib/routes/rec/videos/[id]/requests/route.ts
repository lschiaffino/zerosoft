import { NextRequest } from 'next/server';
import { listAccessRequests } from '@/lib/rec-admin';
import { recActor, recFail, recJson } from '@/lib/rec-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pedidos de acceso pendientes (solo quien administra el video). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  try {
    return recJson({ requests: await listAccessRequests(s.actor, id) });
  } catch (err) {
    return recFail(err);
  }
}
