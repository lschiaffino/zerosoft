import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canSeeActivity, sessionScope } from '@/lib/crm-visibility';
import { deleteActivity, getActivity, updateActivity } from '@/lib/crm';
import { mentionablePeople, notifyActivityMentions } from '@/lib/crm-mention-notify';
import { requestLocale } from '@/lib/request-locale';
import { activityUpdateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await canSeeActivity(user.id, params.id, await sessionScope(user)))) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = activityUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const before = await getActivity(user.id, params.id);
  const activity = await catchRef(updateActivity(user.id, params.id, parsed.data));
  if (activity instanceof CrmRefError) return crmError(400, activity.code);
  if (!activity) return notFound();
  // Solo se avisa a quienes la edición suma como mencionados.
  if (before && (parsed.data.subject !== undefined || parsed.data.body !== undefined)) {
    await notifyActivityMentions({
      activity,
      actor: user.actingUser ?? user,
      people: await mentionablePeople(user),
      before: `${before.subject}\n${before.body}`,
      locale: requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language')),
    }).catch(() => []);
  }
  return NextResponse.json(activity);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await canSeeActivity(user.id, params.id, await sessionScope(user)))) return notFound();
  if (!(await deleteActivity(user.id, params.id, user.actingUser?.email ?? user.email))) return notFound();
  return new NextResponse(null, { status: 204 });
}
