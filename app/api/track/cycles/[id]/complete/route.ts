import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessTrackProject, completeCycle, getCycle, getProject } from '@/lib/track-data';
import { cycleCompleteSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/track/cycles/:id/complete — completa el cycle y mueve los issues
 * sin terminar al siguiente cycle (o a `targetCycleId`; `null` = sin cycle).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const cycle = await getCycle(params.id);
  const project = cycle ? await getProject(cycle.project_id) : undefined;
  if (!cycle || !project || !canAccessTrackProject(project, user.team?.id ?? null, user.id)) return notFound();

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = cycleCompleteSchema.safeParse(body ?? {});
  if (!parsed.success) return invalidBody(parsed.error);

  const result = await completeCycle(cycle.id, parsed.data.targetCycleId);
  if (!result.ok) return result.reason === 'not_found' ? notFound() : trackError(400, result.reason);
  return NextResponse.json(result);
}
