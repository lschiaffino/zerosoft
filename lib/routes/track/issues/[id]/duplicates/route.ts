import { NextResponse } from 'next/server';
import { issueAccess } from '@/lib/track-triage-http';
import { duplicateCandidates } from '@/lib/track-ai';
import { canAccessTrackProject, getIssue, getProject } from '@/lib/track-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Duplicados sugeridos (títulos parecidos) para el picker de "Duplicate" (3) del triage. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const a = await issueAccess((await props.params).id);
  if (!a.ok) return a.res;
  const rows = [];
  // Solo issues de teams que la persona puede ver (los privados no se filtran).
  for (const c of await duplicateCandidates(a.issue.id, 8)) {
    const issue = await getIssue(c.id);
    const project = issue ? await getProject(issue.project_id) : undefined;
    if (project && (await canAccessTrackProject(project, a.user.team?.id ?? null, a.user.id))) rows.push(c);
    if (rows.length >= 5) break;
  }
  return NextResponse.json({ rows });
}
