import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteCycle, getCycle, getProject, canAccessTrackProject, listCycles, updateCycle } from '@/lib/track-data';
import { overlappingCycle } from '@/lib/track-tasks';
import { cycleUpdateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleCycle(id: string, teamId: string | null, ownerId: string) {
  const cycle = await getCycle(id);
  if (!cycle) return null;
  const project = await getProject(cycle.project_id);
  if (!project) return null;
  if (!(await canAccessTrackProject(project, teamId, ownerId))) return null;
  return cycle;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const cycle = await accessibleCycle(params.id, user.team?.id ?? null, user.id);
  if (!cycle) return notFound();

  return NextResponse.json(cycle);
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const cycle = await accessibleCycle(params.id, user.team?.id ?? null, user.id);
  if (!cycle) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = cycleUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const start = (parsed.data.startAt ?? cycle.start_at).slice(0, 10);
  const end = (parsed.data.endAt ?? cycle.end_at).slice(0, 10);
  if (end < start) return trackError(400, 'invalid_range');
  if (overlappingCycle(await listCycles(cycle.project_id), start, end, cycle.id)) return trackError(409, 'cycle_overlap');

  const updated = await updateCycle(params.id, parsed.data);
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Saca a todos los issues del cycle y no se puede deshacer: solo owner/admin.
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');

  const cycle = await accessibleCycle(params.id, user.team?.id ?? null, user.id);
  if (!cycle) return notFound();

  await deleteCycle(params.id);
  return NextResponse.json({ ok: true });
}
