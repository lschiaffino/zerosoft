import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { deleteMilestone, getMilestone, updateMilestone } from '@/lib/track-milestones';
import { milestoneUpdateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleMilestone(id: string, teamId: string | null, ownerId: string) {
  const milestone = await getMilestone(id);
  if (!milestone) return null;
  const project = await getProject(milestone.project_id);
  if (!project || !(await canAccessTrackProject(project, teamId, ownerId))) return null;
  return milestone;
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await accessibleMilestone(id, user.team?.id ?? null, user.id))) return notFound();
  const parsed = milestoneUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(await updateMilestone(id, parsed.data));
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Saca a todos sus issues del milestone: solo owner/admin, como los cycles.
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  if (!(await accessibleMilestone(id, user.team?.id ?? null, user.id))) return notFound();
  await deleteMilestone(id);
  return NextResponse.json({ ok: true });
}
