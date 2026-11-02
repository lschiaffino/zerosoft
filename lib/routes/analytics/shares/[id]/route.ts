import { NextRequest, NextResponse } from 'next/server';
import { revokeShare } from '@/lib/analytics/records-more';
import { aError, analyticsActor, canManageAnalytics, isResponse, recordProject } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Revoca un link público: deja de responder al instante. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_shares', id);
  if (isResponse(project)) return project;
  await revokeShare(project.id, id);
  return NextResponse.json({ ok: true });
}
