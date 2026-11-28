import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { teamCan } from '@/lib/track-team-guard';
import {
  canAccessTrackProject,
  deleteStatusWithReassign,
  getProject,
  getStatus,
  listStatuses,
  updateStatus,
} from '@/lib/track-data';
import { statusDeleteSchema, statusUpdateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleStatus(id: string, teamId: string | null, ownerId: string) {
  const status = await getStatus(id);
  if (!status) return null;
  const project = await getProject(status.project_id);
  if (!project || !(await canAccessTrackProject(project, teamId, ownerId))) return null;
  return Object.assign(status, { project });
}

/** PATCH /api/track/statuses/:id — renombrar, color, categoría. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const status = await accessibleStatus(params.id, user.team?.id ?? null, user.id);
  if (!status) return notFound();
  // Estados del workflow: ajustes del team (lib/track-team-roles).
  if (!(await teamCan(user, status.project, 'settings'))) return trackError(403, 'forbidden');

  const body: unknown = await req.json().catch(() => null);
  const parsed = statusUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  return NextResponse.json(await updateStatus(params.id, parsed.data));
}

/**
 * DELETE /api/track/statuses/:id — body { reassignTo }: los issues con este
 * status pasan a `reassignTo` (mismo proyecto). No se puede borrar el último.
 */
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const status = await accessibleStatus(params.id, user.team?.id ?? null, user.id);
  if (!status) return notFound();
  // Borrar un estado mueve issues: solo dueños del team o admins.
  if (!(await teamCan(user, status.project, 'owner'))) return trackError(403, 'forbidden');

  const body: unknown = await req.json().catch(() => null);
  const parsed = statusDeleteSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const siblings = await listStatuses(status.project_id);
  if (siblings.length <= 1) return trackError(400, 'last_status');

  const result = await deleteStatusWithReassign(params.id, parsed.data.reassignTo);
  if (!result.ok) return result.reason === 'not_found' ? notFound() : trackError(400, result.reason);
  return NextResponse.json(result);
}
