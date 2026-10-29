import { NextRequest, NextResponse } from 'next/server';
import { rotateSecret } from '@/lib/analytics/projects';
import { aError, analyticsActor, canManageAnalytics, isResponse } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Nueva key secreta del proyecto: se devuelve una sola vez (admins). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const secret = await rotateSecret(actor.workspaceId, (await ctx.params).id);
  if (!secret) return aError(404, 'project_not_found');
  return NextResponse.json({ secret });
}
