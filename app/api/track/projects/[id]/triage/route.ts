import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { listTriageIssues } from '@/lib/track-bulk';
import { notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cola de triage del proyecto. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const project = await getProject(id);
  if (!project || !canAccessTrackProject(project, user.team?.id ?? null, user.id)) return notFound();
  return NextResponse.json({ rows: await listTriageIssues(id), enabled: Boolean(project.triage_enabled) });
}
