import { NextRequest, NextResponse } from 'next/server';
import { guardRecordCustomWrite, hiddenFieldsFor, redactRow, sessionFieldViewer } from '@/lib/crm-field-perms';
import { getCurrentUser } from '@/lib/session';
import { deleteCompany, getCompany, updateCompany } from '@/lib/crm';
import { companyUpdateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized, guardRecord } from '@/lib/crm-http';
import { sessionScope, scopeCompanyDetail } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'company', params.id, scope);
  if (hidden) return hidden;
  const detail = await getCompany(user.id, params.id);
  if (!detail) return notFound();
  const scoped = scopeCompanyDetail(detail, scope);
  const hiddenFields = await hiddenFieldsFor(sessionFieldViewer(user), 'companies');
  return NextResponse.json({ ...scoped, company: redactRow(scoped.company, hiddenFields) });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'company', params.id, scope);
  if (hidden) return hidden;

  const body: unknown = await req.json().catch(() => null);
  const parsed = companyUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const fieldViewer = sessionFieldViewer(user);
  const fp = await guardRecordCustomWrite(fieldViewer, 'company', params.id, parsed.data.custom);
  if (!fp.ok) return crmError(403, 'field_readonly');
  const company = await catchRef(updateCompany(user.id, params.id, { ...parsed.data, custom: fp.custom }, undefined, user.actingUser?.email ?? user.email));
  if (company instanceof CrmRefError) return crmError(400, company.code);
  if (!company) return notFound();
  return NextResponse.json(redactRow(company, await hiddenFieldsFor(fieldViewer, 'companies')));
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'company', params.id, scope);
  if (hidden) return hidden;
  if (!(await deleteCompany(user.id, params.id, user.actingUser?.email ?? user.email))) return notFound();
  return new NextResponse(null, { status: 204 });
}
