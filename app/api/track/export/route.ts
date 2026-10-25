import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { exportIssuesCsv } from '@/lib/track-export';
import { notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** CSV con los issues del workspace (?projectId= para uno solo). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const teamId = user.team?.id ?? null;
  const projectId = req.nextUrl.searchParams.get('projectId');
  let name = 'issues';
  if (projectId) {
    const project = await getProject(projectId);
    if (!project || !(await canAccessTrackProject(project, teamId, user.id))) return notFound();
    name = project.slug;
  }
  const csv = await exportIssuesCsv(teamId, user.id, projectId);
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(`﻿${csv}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="track-${name}-${day}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
