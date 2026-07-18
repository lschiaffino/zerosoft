import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import {
  ACTIVITY_TYPES,
  createActivity,
  listTasks,
  listTimeline,
  type ActivityType,
  type TaskBucket,
} from '@/lib/crm';
import { activityCreateSchema } from '@/lib/crm-schema';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKETS: readonly TaskBucket[] = ['overdue', 'today', 'upcoming', 'done'];

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const bucket = sp.get('bucket');
  if (bucket) {
    if (!BUCKETS.includes(bucket as TaskBucket)) return crmError(400, 'invalid_input');
    return NextResponse.json({ rows: listTasks(user.id, bucket as TaskBucket) });
  }

  const type = sp.get('type');
  if (type && !(ACTIVITY_TYPES as readonly string[]).includes(type)) {
    return crmError(400, 'invalid_input');
  }
  const rows = listTimeline(user.id, {
    contactId: sp.get('contactId') ?? undefined,
    companyId: sp.get('companyId') ?? undefined,
    dealId: sp.get('dealId') ?? undefined,
    type: (type as ActivityType | null) ?? undefined,
  });
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = activityCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const activity = createActivity(user.id, parsed.data);
  return NextResponse.json(activity, { status: 201 });
}
