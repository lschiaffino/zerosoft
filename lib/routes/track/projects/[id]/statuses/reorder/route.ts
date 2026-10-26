import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getProject, reorderStatuses, canAccessTrackProject } from '@/lib/track-data';
import { statusesReorderSchema } from '@/lib/track-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleProject(id: string, teamId: string | null, ownerId: string) {
  const project = await getProject(id);
  if (!project) return null;
  if (!(await canAccessTrackProject(project, teamId, ownerId))) return null;
  return project;
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const project = await accessibleProject(params.id, user.team?.id ?? null, user.id);
  if (!project) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = statusesReorderSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const rows = await reorderStatuses(params.id, parsed.data);
  return NextResponse.json({ rows });
}
