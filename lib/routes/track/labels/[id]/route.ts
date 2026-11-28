import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, type SessionUser } from '@/lib/session';
import { deleteLabel, getLabel, trackWorkspaceId, updateLabel } from '@/lib/track-labels';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { teamCan, teamLabelParentOk } from '@/lib/track-team-guard';
import { labelUpdateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Los labels del workspace los cambian los admins; los de un team, también
 * quien tenga el permiso de labels de ese team (sus dueños por defecto,
 * lib/track-team-roles). Devuelve el team del label si no es admin.
 */
async function canManageLabel(user: SessionUser, id: string): Promise<{ ok: boolean; projectId: string | null }> {
  if (isWorkspaceAdmin(user)) return { ok: true, projectId: null };
  const label = await getLabel(trackWorkspaceId(user.team?.id ?? null, user.id), id);
  if (!label?.project_id) return { ok: false, projectId: null };
  const project = await getProject(label.project_id);
  if (!project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) return { ok: false, projectId: null };
  return { ok: await teamCan(user, project, 'labels'), projectId: project.id };
}

/** Renombra o recolorea el label en todo el workspace: admins (o el team si es suyo). */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const can = await canManageLabel(user, id);
  if (!can.ok) return trackError(403, 'forbidden');
  const parsed = labelUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const ws = trackWorkspaceId(user.team?.id ?? null, user.id);
  // Un label de team solo se agrupa bajo un grupo general o de su mismo team.
  if (can.projectId && parsed.data.parentId && !(await teamLabelParentOk(ws, parsed.data.parentId, can.projectId))) return trackError(400, 'invalid_parent');
  const res = await updateLabel(ws, id, parsed.data);
  if (!res.ok) return res.reason === 'not_found' ? notFound() : res.reason === 'invalid_parent' ? trackError(400, 'invalid_parent') : trackError(409, 'duplicate_label');
  return NextResponse.json(res.label);
}

/** Borra el label y lo saca de todos los issues: admins (o el team si es suyo). */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await canManageLabel(user, id)).ok) return trackError(403, 'forbidden');
  const ok = await deleteLabel(trackWorkspaceId(user.team?.id ?? null, user.id), id);
  if (!ok) return notFound();
  return NextResponse.json({ ok: true });
}
