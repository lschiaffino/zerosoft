import type { NextRequest } from 'next/server';
import { withViewer } from '@/lib/bi/http';
import { createSubscription, listSubscriptions } from '@/lib/bi/subscriptions';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'read', async (viewer) => ({ subscriptions: await listSubscriptions(viewer, id) }));
}

/** Suscribe por email (personas del workspace) o a un canal de Talk. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'write', async (viewer, body) => ({ subscription: await createSubscription(viewer, id, body) }), 201);
}
