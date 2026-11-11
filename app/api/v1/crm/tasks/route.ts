import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import {
  createActivity,
  listTasks,
  listTimeline,
  type ActivityListRow,
  type TaskBucket,
} from '@/lib/crm';
import { activityCreateSchema } from '@/lib/crm-schema';
import { catchRef, cleanRow, CrmRefError, pageParams, zodErrorCode } from '@/lib/crm-http';
import { apiScope } from '@/lib/crm-visibility';
import { z } from 'zod';
import { API_LINK_KINDS } from '@/lib/tasks-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKETS: readonly TaskBucket[] = ['overdue', 'today', 'upcoming', 'done'];
const taskCreateSchema = activityCreateSchema.omit({ type: true }).extend({
  /** Registros de otras apps: chat o mensaje de Groups, conversación de Chat, página de Docs. */
  links: z
    .array(z.object({ kind: z.enum(API_LINK_KINDS), id: z.string().min(1).max(100) }))
    .max(10)
    .optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;

  const sp = req.nextUrl.searchParams;
  const bucket = sp.get('bucket');
  let rows: ActivityListRow[];
  if (bucket) {
    if (!BUCKETS.includes(bucket as TaskBucket)) {
      return apiError(400, 'invalid_input', 'bucket must be one of: overdue, today, upcoming, done.');
    }
    rows = await listTasks(auth.user.id, { bucket: bucket as TaskBucket, ownerScope: await apiScope(auth) });
  } else {
    rows = await listTimeline(auth.user.id, { type: 'task', limit: 500, ownerScope: await apiScope(auth) });
  }

  const { page, pageSize } = pageParams(sp);
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const { taskLinks } = await import('@/lib/tasks');
  const links = await taskLinks(auth.user.id, pageRows.map((r) => r.id));
  return NextResponse.json({
    tasks: pageRows.map((r) => ({ ...cleanRow(r), links: apiLinks(links.get(r.id)) })),
    total: rows.length,
    page,
    pageSize,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = taskCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  }

  const { links: wanted, ...data } = parsed.data;
  const { linkTargetExists, linkTask, taskLinks } = await import('@/lib/tasks');
  for (const l of wanted ?? []) {
    if (!(await linkTargetExists(auth.user.id, l.kind, l.id, { personId: auth.personId, role: auth.role }))) return apiError(400, 'invalid_link', 'A linked record does not exist.');
  }
  const task = await catchRef(createActivity(auth.user.id, { ...data, type: 'task' }));
  if (task instanceof CrmRefError) return apiError(400, task.code, 'A referenced record does not exist.');
  for (const l of wanted ?? []) await linkTask(auth.user.id, task.id, l.kind, l.id, auth.personId);
  const links = await taskLinks(auth.user.id, [task.id]);
  return NextResponse.json({ ...cleanRow(task), links: apiLinks(links.get(task.id)) }, { status: 201 });
}

/** Vínculos en la API: tipo, id y link de vuelta (sin nombres: pueden ser de apps que la key no lee). */
function apiLinks(links: Array<{ kind: string; refId: string; href: string; missing: boolean }> | undefined) {
  return (links ?? []).map((l) => ({ kind: l.kind, id: l.refId, url: l.href || null, missing: l.missing }));
}
