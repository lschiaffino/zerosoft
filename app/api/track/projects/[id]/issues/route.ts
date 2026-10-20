import { after, NextRequest, NextResponse } from 'next/server';
import { emitEvent } from '@/lib/events';
import { getCurrentUser, realUserId } from '@/lib/session';
import { validateIssueRefs } from '@/lib/track-bulk';
import { createIssue, getProject, listIssues, canAccessTrackProject } from '@/lib/track-data';
import { issueCreateSchema } from '@/lib/track-schema';
import { ISSUE_SORTS } from '@/lib/track-views';
import { invalidBody, notFound, pageParams, sortParam, stringArrayParam, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleProject(id: string, teamId: string | null, ownerId: string) {
  const project = await getProject(id);
  if (!project) return null;
  if (!canAccessTrackProject(project, teamId, ownerId)) return null;
  return project;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const project = await accessibleProject(params.id, user.team?.id ?? null, user.id);
  if (!project) return notFound();

  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const result = await listIssues(params.id, {
    statusId: stringArrayParam(sp, 'statusId'),
    priority: stringArrayParam(sp, 'priority'),
    assigneeId: stringArrayParam(sp, 'assigneeId'),
    cycleId: stringArrayParam(sp, 'cycleId'),
    labelIds: stringArrayParam(sp, 'labelIds'),
    q: sp.get('q') ?? undefined,
    dueAfter: sp.get('dueAfter') ?? undefined,
    dueBefore: sp.get('dueBefore') ?? undefined,
    sort: sortParam(sp, ISSUE_SORTS),
    page,
    pageSize,
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const project = await accessibleProject(params.id, user.team?.id ?? null, user.id);
  if (!project) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = issueCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const invalid = await validateIssueRefs(project, parsed.data, { ownerId: user.id });
  if (invalid) return trackError(400, invalid);

  const issue = await createIssue(params.id, realUserId(user), parsed.data, { source: 'app' });
  after(() =>
    emitEvent(user.id, 'issue.created', {
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        priority: issue.priority,
        status: issue.status_name ?? null,
        assigneeId: issue.assignee_id,
      },
      project: { id: project.id, name: project.name },
    }),
  );
  return NextResponse.json(issue, { status: 201 });
}
