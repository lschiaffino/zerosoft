import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canSeeActivity, canSeeActivityRefs, sessionScope } from '@/lib/crm-visibility';
import { isChatHidden, redactChatTask, sessionChatReader } from '@/lib/crm-chat-privacy';
import { deleteActivity, getActivity, updateActivity } from '@/lib/crm';
import { unpinSiblings } from '@/lib/crm-timeline';
import { mentionablePeople, mentionsNotNotified, notifyMentionsDetailed } from '@/lib/crm-mention-notify';
import { requestLocale } from '@/lib/request-locale';
import { activityUpdateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  if (!(await canSeeActivity(user.id, params.id, scope))) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = activityUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  // Asociar a otro registro (timeline › Asociaciones): solo a registros que la persona ve.
  const { contactId, companyId, dealId } = parsed.data;
  if (
    (contactId || companyId || dealId) &&
    !(await canSeeActivityRefs(user.id, { contact_id: contactId ?? null, company_id: companyId ?? null, deal_id: dealId ?? null }, scope))
  ) {
    return notFound();
  }

  // Tarea de un chat de Lines que la persona no ve: puede completarla, moverla o reasignarla, pero no
  // reescribir un texto que no ve, y la respuesta tampoco lo trae.
  const locale = requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
  const reader = await sessionChatReader(user, locale);
  const textEdit = parsed.data.subject !== undefined || parsed.data.body !== undefined;
  if (textEdit && (await isChatHidden(user.id, params.id, reader))) return crmError(403, 'chat_private');
  const before = await getActivity(user.id, params.id);
  // Una sola fijada por registro (como en HubSpot): fijar esta desfija las otras de sus registros.
  if (parsed.data.pinned === true) await unpinSiblings(user.id, params.id);
  const updated = await catchRef(updateActivity(user.id, params.id, parsed.data));
  if (updated instanceof CrmRefError) return crmError(400, updated.code);
  if (!updated) return notFound();
  const activity = (await redactChatTask(user.id, updated, reader)) ?? updated;
  // Solo se avisa a quienes la edición suma como mencionados (y pueden ver la actividad).
  if (before && textEdit) {
    const people = await mentionablePeople(user);
    const mentions = await notifyMentionsDetailed({
      activity: updated,
      actor: user.actingUser ?? user,
      people,
      workspaceId: user.id,
      before: `${before.subject}\n${before.body}`,
      locale,
    }).catch(() => ({ notified: [], withoutAccess: [] as string[] }));
    return NextResponse.json({ ...activity, ...mentionsNotNotified(mentions.withoutAccess, people) });
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
