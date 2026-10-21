import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope, visibleIds } from '@/lib/crm-visibility';
import { findDuplicateCompanies } from '@/lib/crm-company-merge';
import { unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Grupos de empresas duplicadas (?companyId= solo los que la incluyen). Solo lo visible para quien pide. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const companyId = req.nextUrl.searchParams.get('companyId') || undefined;
  const groups = await findDuplicateCompanies(user.id, { companyId });
  const scope = await sessionScope(user);
  const visible = new Set(
    await visibleIds(user.id, 'crm_companies', groups.flatMap((g) => g.companies.map((c) => c.id)), scope),
  );
  const out = groups
    .map((g) => ({ ...g, companies: g.companies.filter((c) => visible.has(c.id)) }))
    .filter((g) => g.companies.length > 1);
  return NextResponse.json({ groups: out });
}
