import { NextRequest, NextResponse } from 'next/server';
import { issueAssignees, issueDetail, issueExists, updateIssue } from '@/lib/analytics/errors';
import { issuePatchSchema, parseIssueRef } from '@/lib/analytics/more-types';
import { dateRangeSchema } from '@/lib/analytics/types';
import { actorProject, aError, analyticsActor, isResponse, readJson } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ ref: string }> };

/** Un error: <proyecto>~<huella>. El proyecto se valida contra el workspace de quien pide. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const ref = parseIssueRef((await ctx.params).ref);
  if (!ref) return aError(404, 'not_found');
  const project = await actorProject(actor, ref.projectId);
  if (isResponse(project)) return aError(404, 'not_found');
  const range = dateRangeSchema.safeParse({ from: req.nextUrl.searchParams.get('from') ?? '-30d' });
  if (!range.success) return aError(400, 'invalid_range');
  const [issue, members] = await Promise.all([issueDetail(project, ref.fingerprint, { from: range.data.from }), issueAssignees(actor.workspaceId)]);
  if (!issue) return aError(404, 'not_found');
  return NextResponse.json({ issue, members });
}

/** Estado y responsable. El responsable tiene que ser del workspace y tener la app. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const ref = parseIssueRef((await ctx.params).ref);
  if (!ref) return aError(404, 'not_found');
  const project = await actorProject(actor, ref.projectId);
  if (isResponse(project)) return aError(404, 'not_found');
  const parsed = issuePatchSchema.omit({ projectId: true }).safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  if (!(await issueExists(project.id, ref.fingerprint))) return aError(404, 'not_found');
  if (parsed.data.assigneeId) {
    const members = await issueAssignees(actor.workspaceId);
    if (!members.some((m) => m.id === parsed.data.assigneeId)) return aError(400, 'invalid_assignee');
  }
  await updateIssue(project, ref.fingerprint, parsed.data);
  return NextResponse.json({ issue: await issueDetail(project, ref.fingerprint, {}) });
}
