import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteIssue, getIssue, getProject, updateIssue } from '@/lib/track-data';
import { issueUpdateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleIssue(id: string, teamId: string | null) {
  const issue = await getIssue(id);
  if (!issue) return null;
  const project = await getProject(issue.project_id);
  if (!project) return null;
  if (project.team_id !== teamId) return null;
  return issue;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const issue = await accessibleIssue(params.id, user.team?.id ?? null);
  if (!issue) return notFound();

  return NextResponse.json(issue);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const issue = await accessibleIssue(params.id, user.team?.id ?? null);
  if (!issue) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = issueUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const updated = await updateIssue(params.id, parsed.data, user.id);
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const issue = await accessibleIssue(params.id, user.team?.id ?? null);
  if (!issue) return notFound();

  await deleteIssue(params.id);
  return NextResponse.json({ ok: true });
}
