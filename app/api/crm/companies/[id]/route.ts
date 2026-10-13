import { NextRequest, NextResponse } from 'next/server';
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
  return NextResponse.json(scopeCompanyDetail(detail, scope));
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

  const company = await catchRef(updateCompany(user.id, params.id, parsed.data, undefined, user.actingUser?.email ?? user.email));
  if (company instanceof CrmRefError) return crmError(400, company.code);
  if (!company) return notFound();
  return NextResponse.json(company);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'company', params.id, scope);
  if (hidden) return hidden;
  if (!(await deleteCompany(user.id, params.id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
