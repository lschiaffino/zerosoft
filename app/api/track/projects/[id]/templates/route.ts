import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { validateIssueRefs } from '@/lib/track-bulk';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { createTemplate, listTemplates } from '@/lib/track-templates';
import { templateCreateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleProject(id: string, teamId: string | null, ownerId: string) {
  const project = await getProject(id);
  if (!project || !canAccessTrackProject(project, teamId, ownerId)) return null;
  return project;
}

/** Plantillas de issue del proyecto. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const project = await accessibleProject(id, user.team?.id ?? null, user.id);
  if (!project) return notFound();
  return NextResponse.json({ rows: await listTemplates(id) });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const project = await accessibleProject(id, user.team?.id ?? null, user.id);
  if (!project) return notFound();
  const parsed = templateCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const invalid = await validateIssueRefs(project, parsed.data, { ownerId: user.id });
  if (invalid) return trackError(400, invalid);
  return NextResponse.json(await createTemplate(project, parsed.data), { status: 201 });
}
