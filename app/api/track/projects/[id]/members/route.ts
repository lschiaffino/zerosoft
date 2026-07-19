import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getProject, listProjectMembers } from '@/lib/track-data';
import { notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleProject(id: string, teamId: string | null) {
  const project = await getProject(id);
  if (!project) return null;
  if (project.team_id !== teamId) return null;
  return project;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const project = await accessibleProject(params.id, user.team?.id ?? null);
  if (!project) return notFound();

  const rows = await listProjectMembers(params.id, user.id);
  return NextResponse.json({ rows });
}
