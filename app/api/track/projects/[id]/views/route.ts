import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { createIssueView, getProject, listIssueViews, canAccessTrackProject } from '@/lib/track-data';
import { issueViewCreateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

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

  const views = await listIssueViews(params.id, realUserId(user));
  return NextResponse.json({ rows: views });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const project = await accessibleProject(params.id, user.team?.id ?? null, user.id);
  if (!project) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = issueViewCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const view = await createIssueView(params.id, realUserId(user), parsed.data);
  return NextResponse.json(view, { status: 201 });
}
