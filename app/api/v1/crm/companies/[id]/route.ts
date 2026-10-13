import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { getCompany, updateCompany, deleteCompany } from '@/lib/crm';
import { companyUpdateSchema } from '@/lib/crm-schema';
import { catchRef, cleanRow, CrmRefError, zodErrorCode, apiGuardRecord } from '@/lib/crm-http';
import { apiScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const hidden = await apiGuardRecord(auth.user.id, 'company', params.id, await apiScope(auth));
  if (hidden) return hidden;

  const detail = await getCompany(auth.user.id, params.id);
  if (!detail) return apiError(404, 'not_found', 'Company not found.');
  return NextResponse.json(cleanRow(detail.company));
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const hidden = await apiGuardRecord(auth.user.id, 'company', params.id, await apiScope(auth));
  if (hidden) return hidden;

  const body: unknown = await req.json().catch(() => null);
  const parsed = companyUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  }

  const company = await catchRef(updateCompany(auth.user.id, params.id, parsed.data, undefined, auth.user.email));
  if (company instanceof CrmRefError) return apiError(400, company.code, 'A referenced record does not exist.');
  if (!company) return apiError(404, 'not_found', 'Company not found.');
  return NextResponse.json(cleanRow(company));
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const hidden = await apiGuardRecord(auth.user.id, 'company', params.id, await apiScope(auth));
  if (hidden) return hidden;
  if (!(await deleteCompany(auth.user.id, params.id))) return apiError(404, 'not_found', 'Company not found.');
  return new NextResponse(null, { status: 204 });
}
