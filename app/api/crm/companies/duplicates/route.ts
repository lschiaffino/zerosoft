import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canSeeEntity, sessionScope, visibleIds } from '@/lib/crm-visibility';
import { findDuplicateCompanies } from '@/lib/crm-company-merge';
import { unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Grupos de empresas duplicadas (?companyId= solo los que la incluyen). Solo lo visible para quien pide. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const companyId = req.nextUrl.searchParams.get('companyId') || undefined;
  const scope = await sessionScope(user);
  // Los duplicados de una empresa que la persona no ve: ninguno (no dice cuáles se le parecen).
  if (companyId && !(await canSeeEntity(user.id, 'company', companyId, scope))) return NextResponse.json({ groups: [] });
  const groups = await findDuplicateCompanies(user.id, { companyId });
  const visible = new Set(
    await visibleIds(user.id, 'crm_companies', groups.flatMap((g) => g.companies.map((c) => c.id)), scope),
  );
  const out = groups
    .map((g) => ({ ...g, companies: g.companies.filter((c) => visible.has(c.id)) }))
    .filter((g) => g.companies.length > 1);
  return NextResponse.json({ groups: out });
}
