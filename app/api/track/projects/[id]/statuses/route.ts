import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createStatus, getProject, listStatuses } from '@/lib/track-data';
import { statusCreateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

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

  const rows = await listStatuses(params.id);
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const project = await accessibleProject(params.id, user.team?.id ?? null);
  if (!project) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = statusCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const status = await createStatus(params.id, parsed.data);
  return NextResponse.json(status, { status: 201 });
}
