import { NextRequest, NextResponse } from 'next/server';
import { guardRecordCustomWrite, hiddenFieldsFor, redactRow, sessionFieldViewer } from '@/lib/crm-field-perms';
import { getCurrentUser } from '@/lib/session';
import { deleteContact, getContact, updateContact } from '@/lib/crm';
import { contactUpdateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized, guardRecord } from '@/lib/crm-http';
import { sessionScope, scopeContactDetail } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'contact', params.id, scope);
  if (hidden) return hidden;
  const detail = await getContact(user.id, params.id);
  if (!detail) return notFound();
  const scoped = scopeContactDetail(detail, scope);
  const hiddenFields = await hiddenFieldsFor(sessionFieldViewer(user), 'contacts');
  return NextResponse.json({ ...scoped, contact: redactRow(scoped.contact, hiddenFields) });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'contact', params.id, scope);
  if (hidden) return hidden;

  const body: unknown = await req.json().catch(() => null);
  const parsed = contactUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const fieldViewer = sessionFieldViewer(user);
  const fp = await guardRecordCustomWrite(fieldViewer, 'contact', params.id, parsed.data.custom);
  if (!fp.ok) return crmError(403, 'field_readonly');
  const contact = await catchRef(updateContact(user.id, params.id, { ...parsed.data, custom: fp.custom }, undefined, user.actingUser?.email ?? user.email));
  if (contact instanceof CrmRefError) return crmError(400, contact.code);
  if (!contact) return notFound();
  return NextResponse.json(redactRow(contact, await hiddenFieldsFor(fieldViewer, 'contacts')));
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'contact', params.id, scope);
  if (hidden) return hidden;
  if (!(await deleteContact(user.id, params.id, user.actingUser?.email ?? user.email))) return notFound();
  return new NextResponse(null, { status: 204 });
}
