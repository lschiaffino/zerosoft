import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { getDb } from '@/lib/db';
import { updateActivity } from '@/lib/crm';
import { activityUpdateSchema } from '@/lib/crm-schema';
import { catchRef, cleanRow, CrmRefError, zodErrorCode } from '@/lib/crm-http';
import { apiScope, canSeeActivity } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const taskUpdateSchema = activityUpdateSchema.omit({ type: true });

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  if (!(await canSeeActivity(auth.user.id, params.id, await apiScope(auth)))) {
    return apiError(404, 'not_found', 'Task not found.');
  }

  const existing = (await getDb()
    .prepare('SELECT type FROM crm_activities WHERE id = ? AND user_id = ?')
    .get(params.id, auth.user.id)) as { type: string } | undefined;
  if (!existing || existing.type !== 'task') {
    return apiError(404, 'not_found', 'Task not found.');
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed = taskUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  }

  const task = await catchRef(updateActivity(auth.user.id, params.id, parsed.data));
  if (task instanceof CrmRefError) return apiError(400, task.code, 'A referenced record does not exist.');
  if (!task) return apiError(404, 'not_found', 'Task not found.');
  return NextResponse.json(cleanRow(task));
}
