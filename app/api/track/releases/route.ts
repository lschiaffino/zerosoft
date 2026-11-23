import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { createRelease, listReleases, RELEASE_STATUSES, type ReleaseStatus } from '@/lib/track-releases';
import { releaseCreateSchema } from '@/lib/track-schema';
import { invalidBody, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Releases de los teams que la persona ve (?projectId= un team, ?status= uno de los estados). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const rows = await listReleases(user.team?.id ?? null, user.id, {
    projectId: sp.get('projectId') ?? undefined,
    status: status && (RELEASE_STATUSES as readonly string[]).includes(status) ? (status as ReleaseStatus) : undefined,
  });
  return NextResponse.json({ rows });
}

/** Nuevo release en un team que la persona ve. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = releaseCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const project = await getProject(parsed.data.projectId);
  if (!project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) return trackError(400, 'invalid_team');
  const release = await createRelease(project.id, realUserId(user), parsed.data);
  return NextResponse.json(release, { status: 201 });
}
