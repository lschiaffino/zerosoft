import { NextRequest, NextResponse } from 'next/server';
import { planningContext } from '@/lib/track-planning-http';
import { canAccessTrackProject, getCycle, getProject } from '@/lib/track-data';
import { cycleMetrics } from '@/lib/track-cycle-metrics';
import { notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

/** Burn-up, scope creep, velocidad y capacidad de un cycle. */
export async function GET(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const cycle = await getCycle(id);
  const project = cycle ? await getProject(cycle.project_id) : undefined;
  if (!cycle || !project || !(await canAccessTrackProject(project, ctx.scope.teamId, ctx.scope.ownerId))) return notFound();
  const raw = req.nextUrl.searchParams.get('today') ?? '';
  const today = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
  return NextResponse.json({ ...(await cycleMetrics(cycle, today)), project: { id: project.id, name: project.name, icon: project.icon } });
}
