import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { validateIssueRefs } from '@/lib/track-bulk';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { deleteRecurring, getRecurring, updateRecurring } from '@/lib/track-recurring';
import { recurringUpdateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessible(id: string, teamId: string | null, ownerId: string) {
  const rule = await getRecurring(id);
  if (!rule) return null;
  const project = await getProject(rule.project_id);
  if (!project || !(await canAccessTrackProject(project, teamId, ownerId))) return null;
  return { rule, project };
}

/** Editar, pausar ({ active: false }) o reanudar una regla. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await accessible(id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  const parsed = recurringUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const invalid = await validateIssueRefs(found.project, parsed.data, { ownerId: user.id });
  if (invalid) return trackError(400, invalid);
  return NextResponse.json(await updateRecurring(found.project, found.rule, parsed.data));
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await accessible(id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  await deleteRecurring(found.project.id, id);
  return NextResponse.json({ ok: true });
}
