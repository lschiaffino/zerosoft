import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { getDb } from '@/lib/db';
import { updateActivity } from '@/lib/crm';
import { activityUpdateSchema } from '@/lib/crm-schema';
import { cleanRow, zodErrorCode } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const taskUpdateSchema = activityUpdateSchema.omit({ type: true });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireApiUser(req);
  if ('res' in auth) return auth.res;

  const existing = getDb()
    .prepare('SELECT type FROM crm_activities WHERE id = ? AND user_id = ?')
    .get(params.id, auth.user.id) as { type: string } | undefined;
  if (!existing || existing.type !== 'task') {
    return apiError(404, 'not_found', 'Task not found.');
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed = taskUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  }

  const task = updateActivity(auth.user.id, params.id, parsed.data);
  if (!task) return apiError(404, 'not_found', 'Task not found.');
  return NextResponse.json(cleanRow(task));
}
