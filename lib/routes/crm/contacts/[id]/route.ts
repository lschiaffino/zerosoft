import { NextRequest, NextResponse } from 'next/server';
import { maskPrivateRef, PRIVATE_REFS } from '@/lib/crm-record-scope';
import { guardRecordCustomWrite, hiddenFieldsFor, redactRecordDetail, redactRow, sessionFieldViewer } from '@/lib/crm-field-perms';
import { getCurrentUser } from '@/lib/session';
import { deleteContact, getContact, updateContact } from '@/lib/crm';
import { contactUpdateSchema } from '@/lib/crm-schema';
import { catchContactWrite, catchRef, crmError, CrmRefError, emailTakenResponse, invalidBody, notFound, unauthorized, guardRecord } from '@/lib/crm-http';
import { ContactEmailTakenError } from '@/lib/crm-contact-email';
import { sessionScope, scopeContactDetail, assertVisibleRefs } from '@/lib/crm-visibility';
import { maskDetailRefs } from '@/lib/crm-record-scope';

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
  // La empresa primaria o la madre de una empresa que la persona no ve no salen ni por id.
  const scoped = await maskDetailRefs(user.id, 'contact', scopeContactDetail(detail, scope), scope);
  // Sin campos ocultos ni en el registro ni en sus asociados.
  return NextResponse.json(await redactRecordDetail(sessionFieldViewer(user), 'contact', scoped));
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
  // No se vincula un registro que la persona no ve (mismo error que un id que no existe).
  const refsHidden = await catchRef(assertVisibleRefs(user.id, parsed.data, await sessionScope(user)));
  if (refsHidden instanceof CrmRefError) return crmError(400, refsHidden.code);
  const contact = await catchContactWrite(updateContact(user.id, params.id, { ...parsed.data, custom: fp.custom }, undefined, user.actingUser?.email ?? user.email));
  if (contact instanceof CrmRefError) return crmError(400, contact.code);
  if (contact instanceof ContactEmailTakenError) return emailTakenResponse(contact, scope);
  if (!contact) return notFound();
  const shown = (await maskPrivateRef(user.id, contact, [PRIVATE_REFS.company([])], await sessionScope(user)))!;
  return NextResponse.json(redactRow(shown, await hiddenFieldsFor(fieldViewer, 'contacts')));
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
