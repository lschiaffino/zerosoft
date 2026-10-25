import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { listTriageIssues } from '@/lib/track-bulk';
import { listTriageSnoozes } from '@/lib/track-triage';
import { notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cola de triage del proyecto. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const project = await getProject(id);
  if (!project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) return notFound();
  const snoozed = req.nextUrl.searchParams.get('snoozed') === '1';
  const [rows, snoozes] = await Promise.all([listTriageIssues(id, { snoozed }), listTriageSnoozes(id)]);
  return NextResponse.json({
    rows: rows.map((r) => ({ ...r, snoozed_until: snoozes.get(r.id) ?? null })),
    snoozedCount: snoozes.size,
    enabled: Boolean(project.triage_enabled),
  });
}
