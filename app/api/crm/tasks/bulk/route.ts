import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canSeeActivity, sessionScope } from '@/lib/crm-visibility';
import { deleteActivity, updateActivity, type ActivityInput } from '@/lib/crm';
import { getDb } from '@/lib/db';
import { canChangeTaskQueue, getQueue, sessionQueueViewer } from '@/lib/crm-task-queues';
import { taskBulkSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, unauthorized } from '@/lib/crm-http';
import { getUserTimeZone } from '@/lib/user-tz';
import { dueOnDate } from '@/lib/crm-tasks-index';
import { TASK_KINDS } from '@/lib/crm-constants';
import { TASK_PRIORITIES } from '@/lib/tasks-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tareas en masa (el listado de Tareas): completar, reabrir, borrar o fijar
 * owner, prioridad, cola, proyecto, tipo o fecha. Cada tarea pasa por la misma
 * regla que editarla de a una: tiene que ser una tarea del workspace que la
 * persona ve. Las que no, cuentan como `failed` sin decir por qué.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = taskBulkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const body = parsed.data;
  const scope = await sessionScope(user);

  let patch: ActivityInput | null = null;
  let dueDate: string | null = null;
  if (body.action === 'set_property') {
    const v = body.value;
    switch (body.field) {
      case 'ownerId':
        patch = { ownerId: v };
        break;
      case 'projectId':
        patch = { projectId: v };
        break;
      case 'queueId':
        if (v && !(await getQueue(sessionQueueViewer(user), v))) return crmError(400, 'invalid_queue');
        patch = { queueId: v };
        break;
      case 'priority': {
        const p = v ?? '';
        if (!(TASK_PRIORITIES as readonly string[]).includes(p)) return crmError(400, 'invalid_input');
        patch = { priority: p as (typeof TASK_PRIORITIES)[number] };
        break;
      }
      case 'taskKind': {
        const k = v === 'todo' || v === null ? '' : v;
        if (!(TASK_KINDS as readonly string[]).includes(k)) return crmError(400, 'invalid_input');
        patch = { taskKind: k as (typeof TASK_KINDS)[number] };
        break;
      }
      case 'dueDate':
        if (v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return crmError(400, 'invalid_date');
        if (v === null) patch = { dueAt: null };
        else dueDate = v;
        break;
    }
  }
  const tz = dueDate ? await getUserTimeZone() : 'UTC';
  const actorEmail = user.actingUser?.email ?? user.email;
  const db = getDb();

  let count = 0;
  let failed = 0;
  for (const id of [...new Set(body.ids)]) {
    const row = (await db.prepare("SELECT id, due_at FROM crm_activities WHERE id = ? AND user_id = ? AND type = 'task'").get(id, user.id)) as
      | { id: string; due_at: string | null }
      | undefined;
    if (!row || !(await canSeeActivity(user.id, id, scope))) {
      failed++;
      continue;
    }
    // La cola privada de otra persona: la tarea no se saca de ahí.
    if (patch && 'queueId' in patch && !(await canChangeTaskQueue(sessionQueueViewer(user), id))) {
      failed++;
      continue;
    }
    if (body.action === 'delete') {
      if (await deleteActivity(user.id, id, actorEmail)) count++;
      else failed++;
      continue;
    }
    const data: ActivityInput & { done?: boolean } =
      body.action === 'complete'
        ? { done: true }
        : body.action === 'reopen'
          ? { done: false }
          : dueDate
            ? { dueAt: dueOnDate(row.due_at, dueDate, tz) }
            : (patch ?? {});
    const updated = await catchRef(updateActivity(user.id, id, data));
    if (updated instanceof CrmRefError) return crmError(400, updated.code);
    if (updated) count++;
    else failed++;
  }
  return NextResponse.json({ count, failed });
}
