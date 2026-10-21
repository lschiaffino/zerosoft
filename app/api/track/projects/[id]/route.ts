import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteProject, getProject, updateProject, canAccessTrackProject } from '@/lib/track-data';
import { projectUpdateSchema } from '@/lib/track-schema';
import { syncAutoCycles } from '@/lib/track-auto-cycles';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleProject(id: string, teamId: string | null, ownerId: string) {
  const project = await getProject(id);
  if (!project) return null;
  if (!canAccessTrackProject(project, teamId, ownerId)) return null;
  return project;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const project = await accessibleProject(params.id, user.team?.id ?? null, user.id);
  if (!project) return notFound();

  return NextResponse.json(project);
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const project = await accessibleProject(params.id, user.team?.id ?? null, user.id);
  if (!project) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = projectUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  // Slug (cambia los identificadores y rompe GitHub), archivar, triage y
  // cycles automáticos son configuración compartida: solo owner/admin.
  const { slug, status, triageEnabled, cycleAuto, cycleWeeks, cycleName } = parsed.data;
  const adminOnly =
    (slug !== undefined && slug !== project.slug) ||
    (status !== undefined && status !== project.status) ||
    (triageEnabled !== undefined && triageEnabled !== Boolean(project.triage_enabled)) ||
    (cycleAuto !== undefined && cycleAuto !== Boolean(project.cycle_auto)) ||
    (cycleWeeks !== undefined && cycleWeeks !== project.cycle_weeks) ||
    (cycleName !== undefined && cycleName !== project.cycle_name);
  if (adminOnly && !isWorkspaceAdmin(user)) return trackError(403, 'forbidden');

  let updated = await updateProject(params.id, parsed.data);
  // Al activar los cycles automáticos se crean ya el actual y el próximo.
  if (updated?.cycle_auto && cycleAuto) {
    await syncAutoCycles(updated, new Date().toISOString().slice(0, 10));
    updated = await getProject(params.id);
  }
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Borrar configuración compartida del workspace: solo owner/admin.
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const project = await accessibleProject(params.id, user.team?.id ?? null, user.id);
  if (!project) return notFound();

  await deleteProject(params.id);
  return NextResponse.json({ ok: true });
}
