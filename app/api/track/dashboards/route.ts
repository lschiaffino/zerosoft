import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { createDashboard, listDashboards } from '@/lib/track-dashboards';
import { dashboardCreateSchema } from '@/lib/track-planning-schema';
import { invalidBody, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Dashboards del workspace y los personales de quien pide. */
export async function GET(req: NextRequest) {
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  return NextResponse.json({ rows: await listDashboards(ctx.scope, ctx.actorId, req.nextUrl.searchParams.get('q') || undefined) });
}

export async function POST(req: NextRequest) {
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const parsed = dashboardCreateSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(await createDashboard(ctx.scope, ctx.actorId, parsed.data), { status: 201 });
}
