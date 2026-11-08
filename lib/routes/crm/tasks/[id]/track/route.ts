import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { canSeeActivity, sessionScope } from '@/lib/crm-visibility';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import { canUseApp } from '@/lib/workspace';
import { limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ projectId: z.string().min(1).max(100) });

/**
 * Pasa la tarea a Track: un issue en un proyecto que la persona ve, vinculado
 * con la tarea (al cerrarse el issue, la tarea se completa). Si ya tenía
 * issue devuelve ese, con created false.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canUseApp({ role: user.role, apps: user.apps ?? '*' }, 'track')) return crmError(403, 'forbidden');
  if (!(await canSeeActivity(user.id, id, await sessionScope(user)))) return notFound();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const limited = await limitWrites('crm:task-track', user.actingUser?.id ?? user.id, 20);
  if (limited) return limited;
  const { promoteTaskToTrack } = await import('@/lib/tasks');
  const res = await promoteTaskToTrack(user.id, user, id, parsed.data.projectId);
  if ('error' in res) return res.error === 'not_found' ? notFound() : crmError(404, res.error);
  return NextResponse.json({ ...res, url: `/app/track/issues/${res.issueId}` }, { status: res.created ? 201 : 200 });
}
