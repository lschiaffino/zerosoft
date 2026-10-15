import { after, NextRequest, NextResponse } from 'next/server';
import { emitEvent } from '@/lib/events';
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

  const updated = await updateIssue(params.id, parsed.data, realUserId(user));
  if (updated) {
    const payload = {
      issue: {
        id: updated.id,
        identifier: updated.identifier,
        title: updated.title,
        priority: updated.priority,
        status: updated.status_name ?? null,
        assigneeId: updated.assignee_id,
      },
      project: { id: updated.project_id },
      changes: Object.keys(parsed.data),
    };
    after(async () => {
      await emitEvent(user.id, 'issue.updated', payload);
      if (updated.status_id !== issue.status_id) {
        await emitEvent(user.id, 'issue.status_changed', {
          ...payload,
          from: issue.status_name ?? null,
          to: updated.status_name ?? null,
        });
      }
    });
  }
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
