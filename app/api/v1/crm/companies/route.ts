import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { createCompany, listCompanies } from '@/lib/crm';
import { companyCreateSchema } from '@/lib/crm-schema';
import { catchRef, cleanRow, CrmRefError, pageParams, zodErrorCode } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const { rows, total } = await listCompanies(auth.user.id, {
    q: sp.get('q') ?? undefined,
    page,
    pageSize,
  });

  return NextResponse.json({ companies: rows.map(cleanRow), total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = companyCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  }

  const company = await catchRef(createCompany(auth.user.id, parsed.data));
  if (company instanceof CrmRefError) return apiError(400, company.code, 'A referenced record does not exist.');
  return NextResponse.json(cleanRow(company), { status: 201 });
}
