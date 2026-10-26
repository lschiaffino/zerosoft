import { NextRequest, NextResponse } from 'next/server';
import { apiFieldViewer, guardRecordCustomWrite, hiddenFieldsFor, redactRow } from '@/lib/crm-field-perms';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { getContact, updateContact, deleteContact } from '@/lib/crm';
import { contactUpdateSchema } from '@/lib/crm-schema';
import { catchRef, cleanRow, CrmRefError, zodErrorCode, apiGuardRecord } from '@/lib/crm-http';
import { apiScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const hidden = await apiGuardRecord(auth.user.id, 'contact', params.id, await apiScope(auth));
  if (hidden) return hidden;

  const detail = await getContact(auth.user.id, params.id);
  if (!detail) return apiError(404, 'not_found', 'Contact not found.');
  return NextResponse.json(cleanRow(redactRow(detail.contact, await hiddenFieldsFor(apiFieldViewer(auth), 'contacts'))));
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const hidden = await apiGuardRecord(auth.user.id, 'contact', params.id, await apiScope(auth));
  if (hidden) return hidden;

  const body: unknown = await req.json().catch(() => null);
  const parsed = contactUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  }

  const fieldViewer = apiFieldViewer(auth);
  const fp = await guardRecordCustomWrite(fieldViewer, 'contact', params.id, parsed.data.custom);
  if (!fp.ok) return apiError(403, 'field_readonly', 'A property in the body is read-only for this key.');
  const contact = await catchRef(updateContact(auth.user.id, params.id, { ...parsed.data, custom: fp.custom }, undefined, auth.user.email));
  if (contact instanceof CrmRefError) return apiError(400, contact.code, 'A referenced record does not exist.');
  if (!contact) return apiError(404, 'not_found', 'Contact not found.');
  return NextResponse.json(cleanRow(redactRow(contact, await hiddenFieldsFor(fieldViewer, 'contacts'))));
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const hidden = await apiGuardRecord(auth.user.id, 'contact', params.id, await apiScope(auth));
  if (hidden) return hidden;
  if (!(await deleteContact(auth.user.id, params.id, auth.user.email))) return apiError(404, 'not_found', 'Contact not found.');
  return new NextResponse(null, { status: 204 });
}
