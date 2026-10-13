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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKETS: readonly TaskBucket[] = ['overdue', 'today', 'upcoming', 'done'];
const taskCreateSchema = activityCreateSchema.omit({ type: true });

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
  return NextResponse.json({
    tasks: rows.slice(start, start + pageSize).map(cleanRow),
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

  const task = await catchRef(createActivity(auth.user.id, { ...parsed.data, type: 'task' }));
  if (task instanceof CrmRefError) return apiError(400, task.code, 'A referenced record does not exist.');
  return NextResponse.json(cleanRow(task), { status: 201 });
}
