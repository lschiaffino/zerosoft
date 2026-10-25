import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { validateIssueRefs } from '@/lib/track-bulk';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { createRecurring, listRecurring } from '@/lib/track-recurring';
import { recurringCreateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleProject(id: string, teamId: string | null, ownerId: string) {
  const project = await getProject(id);
  if (!project || !(await canAccessTrackProject(project, teamId, ownerId))) return null;
  return project;
}

/** Issues que se repiten en el proyecto. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const project = await accessibleProject(id, user.team?.id ?? null, user.id);
  if (!project) return notFound();
  return NextResponse.json({ rows: await listRecurring(id) });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const project = await accessibleProject(id, user.team?.id ?? null, user.id);
  if (!project) return notFound();
  const parsed = recurringCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const invalid = await validateIssueRefs(project, parsed.data, { ownerId: user.id });
  if (invalid) return trackError(400, invalid);
  return NextResponse.json(await createRecurring(project, realUserId(user), parsed.data), { status: 201 });
}
