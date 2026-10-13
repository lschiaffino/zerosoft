import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteActivity, updateActivity } from '@/lib/crm';
import { activityUpdateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = activityUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const activity = await catchRef(updateActivity(user.id, params.id, parsed.data));
  if (activity instanceof CrmRefError) return crmError(400, activity.code);
  if (!activity) return notFound();
  return NextResponse.json(activity);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await deleteActivity(user.id, params.id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
