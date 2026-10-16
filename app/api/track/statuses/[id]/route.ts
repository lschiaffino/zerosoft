import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
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
  if (!project || !canAccessTrackProject(project, teamId, ownerId)) return null;
  return status;
}

/** PATCH /api/track/statuses/:id — renombrar, color, categoría. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const status = await accessibleStatus(params.id, user.team?.id ?? null, user.id);
  if (!status) return notFound();

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
  // Configuración compartida del proyecto: solo owner/admin.
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');

  const status = await accessibleStatus(params.id, user.team?.id ?? null, user.id);
  if (!status) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = statusDeleteSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const siblings = await listStatuses(status.project_id);
  if (siblings.length <= 1) return trackError(400, 'last_status');

  const result = await deleteStatusWithReassign(params.id, parsed.data.reassignTo);
  if (!result.ok) return result.reason === 'not_found' ? notFound() : trackError(400, result.reason);
  return NextResponse.json(result);
}
