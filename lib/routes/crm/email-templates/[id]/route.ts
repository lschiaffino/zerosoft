import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { canManageOwned, deleteEmailTemplate, getEmailTemplate, updateEmailTemplate } from '@/lib/crm-email';
import { templateUpdateSchema } from '@/lib/crm-email-schema';
import { forbidden, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const template = await getEmailTemplate(user.id, id);
  return template ? NextResponse.json(template) : notFound();
}

/** Editar/borrar: admins, o quien creó el template. */
export async function PATCH(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const existing = await getEmailTemplate(user.id, id);
  if (!existing) return notFound();
  if (!canManageOwned({ isAdmin: isWorkspaceAdmin(user), personId: realUserId(user) }, existing.created_by)) return forbidden();
  const body: unknown = await req.json().catch(() => null);
  const parsed = templateUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(await updateEmailTemplate(user.id, id, parsed.data));
}

export async function DELETE(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const existing = await getEmailTemplate(user.id, id);
  if (!existing) return notFound();
  if (!canManageOwned({ isAdmin: isWorkspaceAdmin(user), personId: realUserId(user) }, existing.created_by)) return forbidden();
  await deleteEmailTemplate(user.id, id);
  return new NextResponse(null, { status: 204 });
}
