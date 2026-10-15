import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { validateIssueRefs } from '@/lib/track-bulk';
import { deleteIssue, getIssue, getProject, updateIssue, canAccessTrackProject } from '@/lib/track-data';
import { issueUpdateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleIssue(id: string, teamId: string | null, ownerId: string) {
  const issue = await getIssue(id);
  if (!issue) return null;
  const project = await getProject(issue.project_id);
  if (!project) return null;
  if (!canAccessTrackProject(project, teamId, ownerId)) return null;
  return { issue, project };
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const found = await accessibleIssue(params.id, user.team?.id ?? null, user.id);
  if (!found) return notFound();

  return NextResponse.json(found.issue);
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const found = await accessibleIssue(params.id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  const { issue, project } = found;

  const body: unknown = await req.json().catch(() => null);
  const parsed = issueUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const invalid = await validateIssueRefs(project, parsed.data, { ownerId: user.id, issueId: issue.id });
  if (invalid) return trackError(400, invalid);

  // updateIssue emite issue.updated / issue.status_changed (after).
  const updated = await updateIssue(params.id, parsed.data, realUserId(user));
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const found = await accessibleIssue(params.id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  // Igual que el borrado masivo: borrar (con sus subtasks) es solo para owner/admin.
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');

  await deleteIssue(params.id);
  return NextResponse.json({ ok: true });
}
