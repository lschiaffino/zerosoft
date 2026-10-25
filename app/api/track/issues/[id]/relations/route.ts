import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import {
  createIssueRelation,
  deleteIssueRelation,
  getIssue,
  getProject,
  hasIssueRelation,
  listIssueRelations, canAccessTrackProject } from '@/lib/track-data';
import { findWorkspaceIssueByIdentifier } from '@/lib/track-bulk';
import { relationCreateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // Permitir pasar un identifier (e.g. PROJ-12) además de UUID, de cualquier
  // proyecto del workspace.
  if (!UUID_RE.test(relatedIssueId)) {
    const byIdentifier = await findWorkspaceIssueByIdentifier(issue.project_id, relatedIssueId);
    if (byIdentifier) relatedIssueId = byIdentifier.id;
  }
  // El issue relacionado también tiene que ser del workspace del usuario.
  if (!(await accessibleIssue(relatedIssueId, user.team?.id ?? null, user.id))) return notFound();
  if (relatedIssueId === params.id) return trackError(400, 'invalid_relation');
  if (await hasIssueRelation(params.id, relatedIssueId)) return trackError(409, 'duplicate_relation');

  try {
    const rows = await createIssueRelation(params.id, realUserId(user), relatedIssueId, parsed.data.type);
    return NextResponse.json({ rows });
  } catch (err) {
    // Dos requests a la vez: el UNIQUE(issue_id, related_issue_id) gana.
    if (/UNIQUE constraint failed/i.test(String(err))) return trackError(409, 'duplicate_relation');
    throw err;
  }
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
