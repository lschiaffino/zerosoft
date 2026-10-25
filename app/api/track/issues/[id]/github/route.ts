import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessTrackProject, getIssue, getProject } from '@/lib/track-data';
import { branchNameFor, getGithubConfig, listIssueLinks } from '@/lib/track-github';
import { projectWorkspaceId } from '@/lib/track-labels';
import { notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PRs y commits vinculados al issue, más el nombre de branch sugerido. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const issue = await getIssue(id);
  const project = issue ? await getProject(issue.project_id) : undefined;
  if (!issue || !project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) return notFound();
  const workspaceId = projectWorkspaceId(project);
  const [rows, config] = await Promise.all([
    listIssueLinks(id),
    workspaceId ? getGithubConfig(workspaceId) : Promise.resolve(null),
  ]);
  return NextResponse.json({
    branchName: branchNameFor(issue.identifier, issue.title),
    connected: Boolean(config),
    rows,
  });
}
