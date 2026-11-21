import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { getDb } from '@/lib/db';
import { updateActivity } from '@/lib/crm';
import { activityUpdateSchema } from '@/lib/crm-schema';
import { catchRef, cleanRow, CrmRefError, zodErrorCode } from '@/lib/crm-http';
import { apiScope, canSeeActivity } from '@/lib/crm-visibility';
import { apiChatReader, isChatHidden, redactChatTask } from '@/lib/crm-chat-privacy';

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

  // Tarea de un chat de Lines que la persona de la key no ve: no reescribe su texto ni lo recibe.
  const reader = await apiChatReader(auth);
  if ((parsed.data.subject !== undefined || parsed.data.body !== undefined) && (await isChatHidden(auth.user.id, params.id, reader))) {
    return apiError(403, 'chat_private', 'This task comes from a Lines chat you cannot see: its subject and notes cannot be changed.');
  }
  const task = await catchRef(updateActivity(auth.user.id, params.id, parsed.data));
  if (task instanceof CrmRefError) return apiError(400, task.code, 'A referenced record does not exist.');
  if (!task) return apiError(404, 'not_found', 'Task not found.');
  return NextResponse.json(cleanRow((await redactChatTask(auth.user.id, task, reader)) ?? task));
}
