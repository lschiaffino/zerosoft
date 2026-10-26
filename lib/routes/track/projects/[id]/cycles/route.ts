import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createCycle, getProject, listCycles, listCyclesWithProgress, canAccessTrackProject } from '@/lib/track-data';
import { overlappingCycle } from '@/lib/track-tasks';
import { cycleCreateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleProject(id: string, teamId: string | null, ownerId: string) {
  const project = await getProject(id);
  if (!project) return null;
  if (!(await canAccessTrackProject(project, teamId, ownerId))) return null;
  return project;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const project = await accessibleProject(params.id, user.team?.id ?? null, user.id);
  if (!project) return notFound();

  const rows = await listCyclesWithProgress(params.id);
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const project = await accessibleProject(params.id, user.team?.id ?? null, user.id);
  if (!project) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = cycleCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  // Dos ciclos del mismo proyecto no se pisan.
  if (overlappingCycle(await listCycles(params.id), parsed.data.startAt, parsed.data.endAt)) {
    return trackError(409, 'cycle_overlap');
  }

  const cycle = await createCycle(params.id, parsed.data);
  return NextResponse.json(cycle, { status: 201 });
}
