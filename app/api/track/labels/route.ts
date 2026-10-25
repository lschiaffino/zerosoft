import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createLabel, listLabels, projectWorkspaceId, trackWorkspaceId } from '@/lib/track-labels';
import { getProject } from '@/lib/track-data';
import { labelCreateSchema } from '@/lib/track-schema';
import { invalidBody, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Labels del workspace activo (con ?counts=1, cuántos issues usan cada uno). Cada uno trae parent_id (grupo) y project_id (team). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const ws = trackWorkspaceId(user.team?.id ?? null, user.id);
  const rows = await listLabels(ws, req.nextUrl.searchParams.get('counts') === '1');
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = labelCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const ws = trackWorkspaceId(user.team?.id ?? null, user.id);
  // Label de un team: el team tiene que ser de este workspace.
  if (parsed.data.projectId) {
    const project = await getProject(parsed.data.projectId);
    if (!project || projectWorkspaceId(project) !== ws) return trackError(400, 'invalid_project');
  }
  const res = await createLabel(ws, parsed.data);
  if (!res.ok) return res.reason === 'not_found' ? trackError(400, 'invalid_parent') : trackError(409, 'duplicate_label');
  return NextResponse.json(res.label, { status: 201 });
}
