import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessTrackProject, getIssue, getProject, moveIssueToTeam } from '@/lib/track-data';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const moveSchema = z.object({ teamId: z.string().trim().min(1).max(64) });

/**
 * "Move to team" (⌘⇧M), como en Linear: el issue y sus sub-issues pasan al
 * team elegido con el estado equivalente y un identificador nuevo.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const teamId = user.team?.id ?? null;
  const issue = await getIssue(id);
  const from = issue ? await getProject(issue.project_id) : undefined;
  if (!issue || !from || !(await canAccessTrackProject(from, teamId, user.id))) return notFound();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = moveSchema.safeParse(body && body.teamId === undefined ? { teamId: body.projectId } : body);
  if (!parsed.success) return invalidBody(parsed.error);
  const to = await getProject(parsed.data.teamId);
  if (!to || !(await canAccessTrackProject(to, teamId, user.id))) return trackError(400, 'invalid_team');
  if (to.status !== 'active') return trackError(400, 'invalid_team');
  const moved = await moveIssueToTeam(issue.id, to.id, realUserId(user));
  if (!moved) return notFound();
  return NextResponse.json(moved);
}
