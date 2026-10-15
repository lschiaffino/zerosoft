import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import {
  createIssueRelation,
  deleteIssueRelation,
  getIssue,
  getIssueByIdentifier,
  getProject,
  listIssueRelations, canAccessTrackProject } from '@/lib/track-data';
import { relationCreateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleIssue(id: string, teamId: string | null, ownerId: string) {
  const issue = await getIssue(id);
  if (!issue) return null;
  const project = await getProject(issue.project_id);
  if (!project) return null;
  if (!canAccessTrackProject(project, teamId, ownerId)) return null;
  return issue;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const issue = await accessibleIssue(params.id, user.team?.id ?? null, user.id);
  if (!issue) return notFound();

  const rows = await listIssueRelations(params.id);
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const issue = await accessibleIssue(params.id, user.team?.id ?? null, user.id);
  if (!issue) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = relationCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  let relatedIssueId = parsed.data.relatedIssueId;
  // Permitir pasar un identifier (e.g. PROJ-12) además de UUID.
  if (!relatedIssueId.includes('-') || relatedIssueId.length < 36) {
    const byIdentifier = await getIssueByIdentifier(issue.project_id, relatedIssueId);
    if (byIdentifier) relatedIssueId = byIdentifier.id;
  }
  // El issue relacionado también tiene que ser del workspace del usuario.
  if (!(await accessibleIssue(relatedIssueId, user.team?.id ?? null, user.id))) return notFound();

  const rows = await createIssueRelation(params.id, realUserId(user), relatedIssueId, parsed.data.type);
  return NextResponse.json({ rows });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const issue = await accessibleIssue(params.id, user.team?.id ?? null, user.id);
  if (!issue) return notFound();

  const sp = req.nextUrl.searchParams;
  const relationId = sp.get('relationId');
  if (!relationId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  if (!(await deleteIssueRelation(relationId, params.id, realUserId(user)))) return notFound();
  const rows = await listIssueRelations(params.id);
  return NextResponse.json({ rows });
}
