import { after, NextRequest, NextResponse } from 'next/server';
import { apiFieldViewer, guardRecordCustomWrite, hiddenFieldsFor, redactRow } from '@/lib/crm-field-perms';
import { shouldEnrichOnCreate, enrichCompany } from '@/lib/crm-enrich';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { createCompany, listCompanies } from '@/lib/crm';
import { companyCreateSchema } from '@/lib/crm-schema';
import { catchRef, cleanRow, CrmRefError, pageParams, zodErrorCode } from '@/lib/crm-http';
import { apiScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;

  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const { rows, total } = await listCompanies(auth.user.id, {
    ownerScope: await apiScope(auth),
    q: sp.get('q') ?? undefined,
    page,
    pageSize,
  });

  const hiddenFields = await hiddenFieldsFor(apiFieldViewer(auth), 'companies');
  return NextResponse.json({ companies: rows.map((r) => cleanRow(redactRow(r, hiddenFields))), total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = companyCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  }

  const fp = await guardRecordCustomWrite(apiFieldViewer(auth), 'company', null, parsed.data.custom);
  if (!fp.ok) return apiError(403, 'field_readonly', 'A property in the body is read-only for this key.');
  const company = await catchRef(createCompany(auth.user.id, { ...parsed.data, custom: fp.custom, ownerId: parsed.data.ownerId ?? auth.personId }));
  if (company instanceof CrmRefError) return apiError(400, company.code, 'A referenced record does not exist.');
  // Datos del sitio en segundo plano (lo que el formulario no precargó).
  if (shouldEnrichOnCreate(company)) {
    const companyId = company.id;
    after(() => enrichCompany(auth.user.id, companyId, { actorEmail: auth.user.email }).then(() => undefined).catch(() => undefined));
  }
  return NextResponse.json(cleanRow(company), { status: 201 });
}
