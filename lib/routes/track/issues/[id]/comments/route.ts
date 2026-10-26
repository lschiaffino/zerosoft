import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { createIssueComment, getIssue, getProject, listIssueComments, canAccessTrackProject } from '@/lib/track-data';
import { commentCreateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleIssue(id: string, teamId: string | null, ownerId: string) {
  const issue = await getIssue(id);
  if (!issue) return null;
  const project = await getProject(issue.project_id);
  if (!project) return null;
  if (!(await canAccessTrackProject(project, teamId, ownerId))) return null;
  return issue;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const issue = await accessibleIssue(params.id, user.team?.id ?? null, user.id);
  if (!issue) return notFound();

  const rows = await listIssueComments(params.id);
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const issue = await accessibleIssue(params.id, user.team?.id ?? null, user.id);
  if (!issue) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = commentCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const comment = await createIssueComment(params.id, realUserId(user), parsed.data);
  return NextResponse.json(comment, { status: 201 });
}
