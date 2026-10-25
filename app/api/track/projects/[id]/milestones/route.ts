import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { createMilestone, listMilestones } from '@/lib/track-milestones';
import { milestoneCreateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleProject(id: string, teamId: string | null, ownerId: string) {
  const project = await getProject(id);
  if (!project || !(await canAccessTrackProject(project, teamId, ownerId))) return null;
  return project;
}

/** Milestones del proyecto con su progreso. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const project = await accessibleProject(id, user.team?.id ?? null, user.id);
  if (!project) return notFound();
  return NextResponse.json({ rows: await listMilestones(id) });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const project = await accessibleProject(id, user.team?.id ?? null, user.id);
  if (!project) return notFound();
  const parsed = milestoneCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(await createMilestone(id, parsed.data), { status: 201 });
}
