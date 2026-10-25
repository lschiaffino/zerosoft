import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { validateIssueRefs } from '@/lib/track-bulk';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { deleteTemplate, getTemplate, updateTemplate } from '@/lib/track-templates';
import { templateUpdateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessible(id: string, teamId: string | null, ownerId: string) {
  const template = await getTemplate(id);
  if (!template) return null;
  const project = await getProject(template.project_id);
  if (!project || !(await canAccessTrackProject(project, teamId, ownerId))) return null;
  return { template, project };
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await accessible(id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  const parsed = templateUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const invalid = await validateIssueRefs(found.project, parsed.data, { ownerId: user.id });
  if (invalid) return trackError(400, invalid);
  return NextResponse.json(await updateTemplate(found.project, id, parsed.data));
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await accessible(id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  await deleteTemplate(found.project.id, id);
  return NextResponse.json({ ok: true });
}
