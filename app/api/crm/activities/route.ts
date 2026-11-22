import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canSeeActivityRefs, canSeeOwnedRow, sessionScope, assertVisibleRefs } from '@/lib/crm-visibility';
import { sessionChatReader } from '@/lib/crm-chat-privacy';
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
import { mentionablePeople, mentionsNotNotified, notifyMentionsDetailed } from '@/lib/crm-mention-notify';
import { requestLocale } from '@/lib/request-locale';
import { getQueue, maskQueueRefs, sessionQueueViewer } from '@/lib/crm-task-queues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKETS: readonly TaskBucket[] = ['overdue', 'today', 'upcoming', 'done'];

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const bucket = sp.get('bucket');
  // Tareas de chats de Lines que la persona no ve: sin su texto (lib/crm-chat-privacy.ts).
  const chatReader = await sessionChatReader(user, requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language')));
  if (bucket) {
    if (!BUCKETS.includes(bucket as TaskBucket)) return crmError(400, 'invalid_input');
    const tasks = await listTasks(user.id, {
      ownerScope: await sessionScope(user),
      chatReader,
      bucket: bucket as TaskBucket,
      projectId: sp.get('projectId') ?? undefined,
      ownerId: sp.get('ownerId') ?? undefined,
    });
    return NextResponse.json({ rows: await maskQueueRefs(sessionQueueViewer(user), tasks) });
  }

  const type = sp.get('type');
  if (type && !(ACTIVITY_TYPES as readonly string[]).includes(type)) {
    return crmError(400, 'invalid_input');
  }
  const rows = await listTimeline(user.id, {
    ownerScope: await sessionScope(user),
    chatReader,
    contactId: sp.get('contactId') ?? undefined,
    companyId: sp.get('companyId') ?? undefined,
    dealId: sp.get('dealId') ?? undefined,
    type: (type as ActivityType | null) ?? undefined,
  });
  return NextResponse.json({ rows: await maskQueueRefs(sessionQueueViewer(user), rows) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = activityCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const scope = await sessionScope(user);
  if (!(await canSeeActivityRefs(user.id, { contact_id: parsed.data.contactId, company_id: parsed.data.companyId, deal_id: parsed.data.dealId, owner_id: realUserId(user) }, scope))) {
    return notFound();
  }
  // Lead o registro de objeto propio: tiene que verse con la visibilidad por owner.
  if (parsed.data.leadId && !(await canSeeOwnedRow(user.id, 'crm_leads', parsed.data.leadId, scope))) return notFound();
  if (parsed.data.objectRecordId && !(await canSeeOwnedRow(user.id, 'crm_object_records', parsed.data.objectRecordId, scope))) {
    return notFound();
  }
  // Cola de tareas: solo una que la persona ve (una privada de otra persona no existe para ella).
  if (parsed.data.queueId && !(await getQueue(sessionQueueViewer(user), parsed.data.queueId))) return crmError(400, 'invalid_queue');
  // No se vincula un registro que la persona no ve (mismo error que un id que no existe).
  const refsHidden = await catchRef(assertVisibleRefs(user.id, parsed.data, await sessionScope(user)));
  if (refsHidden instanceof CrmRefError) return crmError(400, refsHidden.code);
  const activity = await catchRef(createActivity(user.id, parsed.data));
  if (activity instanceof CrmRefError) return crmError(400, activity.code);
  // @menciones: aviso in-app y por email a cada persona mencionada que puede ver la actividad. A quien
  // escribe se le dice quiénes no la ven (no reciben nada).
  const people = await mentionablePeople(user);
  const mentions = await notifyMentionsDetailed({
    activity,
    actor: user.actingUser ?? user,
    people,
    workspaceId: user.id,
    locale: requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language')),
  }).catch(() => ({ notified: [], withoutAccess: [] as string[] }));
  return NextResponse.json({ ...activity, ...mentionsNotNotified(mentions.withoutAccess, people) }, { status: 201 });
}
