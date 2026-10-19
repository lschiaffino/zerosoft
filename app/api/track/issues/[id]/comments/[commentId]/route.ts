import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import {
  canAccessTrackProject,
  deleteIssueComment,
  getIssue,
  getProject,
  updateIssueComment,
} from '@/lib/track-data';
import { commentUpdateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; commentId: string }> };

async function accessibleIssue(id: string, teamId: string | null, ownerId: string) {
  const issue = await getIssue(id);
  if (!issue) return null;
  const project = await getProject(issue.project_id);
  if (!project) return null;
  if (!canAccessTrackProject(project, teamId, ownerId)) return null;
  return issue;
}

/** Edita un comentario propio. Solo el autor (no el dueño del workspace). */
export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const issue = await accessibleIssue(params.id, user.team?.id ?? null, user.id);
  if (!issue) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = commentUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const res = await updateIssueComment(issue.id, params.commentId, realUserId(user), parsed.data);
  if (!res.ok) return res.reason === 'forbidden' ? trackError(403, 'forbidden') : notFound();
  return NextResponse.json(res.value);
}

/** Borra un comentario propio y su entrada del timeline. */
export async function DELETE(_req: NextRequest, props: Params) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const issue = await accessibleIssue(params.id, user.team?.id ?? null, user.id);
  if (!issue) return notFound();

  const res = await deleteIssueComment(issue.id, params.commentId, realUserId(user));
  if (!res.ok) return res.reason === 'forbidden' ? trackError(403, 'forbidden') : notFound();
  return NextResponse.json({ ok: true });
}
