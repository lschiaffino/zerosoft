import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canSeeActivityRefs, sessionScope } from '@/lib/crm-visibility';
import {
  ACTIVITY_TYPES,
  createActivity,
  listTasks,
  listTimeline,
  type ActivityType,
  type TaskBucket,
} from '@/lib/crm';
import { activityCreateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import { mentionablePeople, notifyActivityMentions } from '@/lib/crm-mention-notify';
import { requestLocale } from '@/lib/request-locale';

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
    return NextResponse.json({
      rows: await listTasks(user.id, {
        ownerScope: await sessionScope(user),
        bucket: bucket as TaskBucket,
        projectId: sp.get('projectId') ?? undefined,
        ownerId: sp.get('ownerId') ?? undefined,
      }),
    });
  }

  const type = sp.get('type');
  if (type && !(ACTIVITY_TYPES as readonly string[]).includes(type)) {
    return crmError(400, 'invalid_input');
  }
  const rows = await listTimeline(user.id, {
    ownerScope: await sessionScope(user),
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

  if (!(await canSeeActivityRefs(user.id, { contact_id: parsed.data.contactId, company_id: parsed.data.companyId, deal_id: parsed.data.dealId, owner_id: realUserId(user) }, await sessionScope(user)))) {
    return notFound();
  }
  const activity = await catchRef(createActivity(user.id, parsed.data));
  if (activity instanceof CrmRefError) return crmError(400, activity.code);
  // @menciones: aviso in-app y por email a cada persona mencionada.
  await notifyActivityMentions({
    activity,
    actor: user.actingUser ?? user,
    people: await mentionablePeople(user),
    workspaceId: user.id,
    locale: requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language')),
  }).catch(() => []);
  return NextResponse.json(activity, { status: 201 });
}
