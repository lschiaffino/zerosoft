import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createIssue, getProject, listIssues } from '@/lib/track-data';
import { issueCreateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, pageParams, sortParam, stringArrayParam, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SORTS = ['newest', 'oldest', 'priority', 'identifier'] as const;

async function accessibleProject(id: string, teamId: string | null) {
  const project = await getProject(id);
  if (!project) return null;
  if (project.team_id !== teamId) return null;
  return project;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const project = await accessibleProject(params.id, user.team?.id ?? null);
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
    sort: sortParam(sp, SORTS),
    page,
    pageSize,
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const project = await accessibleProject(params.id, user.team?.id ?? null);
  if (!project) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = issueCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const issue = await createIssue(params.id, user.id, parsed.data);
  return NextResponse.json(issue, { status: 201 });
}
