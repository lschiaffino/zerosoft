import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createCompany, listCompanies } from '@/lib/crm';
import { companyCreateSchema } from '@/lib/crm-schema';
import { invalidBody, pageParams, sortParam, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SORTS = ['newest', 'oldest', 'name'] as const;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const { rows, total } = await listCompanies(user.id, {
    q: sp.get('q') ?? undefined,
    industry: sp.get('industry') ?? undefined,
    lifecycle: sp.get('lifecycle') ?? undefined,
    sort: sortParam(sp, SORTS),
    page,
    pageSize,
  });

  return NextResponse.json({ rows, total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = companyCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const company = await createCompany(user.id, parsed.data);
  return NextResponse.json(company, { status: 201 });
}
