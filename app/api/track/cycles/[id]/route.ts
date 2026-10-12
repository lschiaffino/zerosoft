import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteCycle, getCycle, getProject, canAccessTrackProject } from '@/lib/track-data';
import { notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleCycle(id: string, teamId: string | null, ownerId: string) {
  const cycle = await getCycle(id);
  if (!cycle) return null;
  const project = await getProject(cycle.project_id);
  if (!project) return null;
  if (!canAccessTrackProject(project, teamId, ownerId)) return null;
  return cycle;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const cycle = await accessibleCycle(params.id, user.team?.id ?? null, user.id);
  if (!cycle) return notFound();

  return NextResponse.json(cycle);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const cycle = await accessibleCycle(params.id, user.team?.id ?? null, user.id);
  if (!cycle) return notFound();

  await deleteCycle(params.id);
  return NextResponse.json({ ok: true });
}
