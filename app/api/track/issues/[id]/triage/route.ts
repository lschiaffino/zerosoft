import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessTrackProject, getIssue, getProject } from '@/lib/track-data';
import { resolveTriage } from '@/lib/track-bulk';
import { triageActionSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Aceptar (con status), rechazar o marcar como duplicado un issue en triage. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const issue = await getIssue(id);
  const project = issue ? await getProject(issue.project_id) : undefined;
  if (!issue || !project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) return notFound();
  const parsed = triageActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await resolveTriage(issue, parsed.data, realUserId(user));
  if (!res.ok) return trackError(res.reason === 'not_in_triage' ? 409 : 400, res.reason);
  return NextResponse.json(res.issue);
}
