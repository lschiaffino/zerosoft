import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId, type SessionUser } from '@/lib/session';
import { deleteForm, FormError, getForm, updateForm, type CrmForm } from '@/lib/crm-forms';
import { formUpdateSchema } from '@/lib/crm-forms-schema';
import { crmError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Editan y borran: admins del workspace o quien creó el form. */
function canEdit(user: SessionUser, form: CrmForm): boolean {
  return isWorkspaceAdmin(user) || form.created_by === realUserId(user);
}

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const form = await getForm(user.id, id);
  if (!form) return notFound();
  return NextResponse.json(form);
}

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const form = await getForm(user.id, id);
  if (!form) return notFound();
  if (!canEdit(user, form)) return forbidden();
  const body: unknown = await req.json().catch(() => null);
  const parsed = formUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    return NextResponse.json(await updateForm(user.id, id, parsed.data, undefined, { person: realUserId(user), admin: isWorkspaceAdmin(user) }));
  } catch (e) {
    if (e instanceof FormError) return crmError(400, e.code);
    throw e;
  }
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const form = await getForm(user.id, id);
  if (!form) return notFound();
  if (!canEdit(user, form)) return forbidden();
  await deleteForm(user.id, id);
  return new NextResponse(null, { status: 204 });
}
