import { after, NextRequest, NextResponse } from 'next/server';
import { guardRecordCustomWrite, hiddenFieldsFor, redactRow, sessionFieldViewer } from '@/lib/crm-field-perms';
import { shouldEnrichOnCreate, enrichCompany } from '@/lib/crm-enrich';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { requestFilter } from '@/lib/crm-filter-http';
import { getUserTimeZone } from '@/lib/user-tz';
import { createCompany, listCompanies } from '@/lib/crm';
import { companyCreateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, pageParams, sortParam, unauthorized } from '@/lib/crm-http';
import { createFormMissing } from '@/lib/crm-create-form';
import { isCreateFormRequest } from '@/lib/crm-create-form-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SORTS = ['newest', 'oldest', 'name'] as const;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const filter = await requestFilter(sp, 'companies', { viewer: sessionFieldViewer(user), viewerId: realUserId(user), timeZone: await getUserTimeZone() });
  if ('error' in filter) return crmError(400, 'invalid_filter');
  const { rows, total } = await listCompanies(user.id, {
    ownerScope: await sessionScope(user),
    ...filter,
    q: sp.get('q') ?? undefined,
    industry: sp.get('industry') ?? undefined,
    lifecycle: sp.get('lifecycle') ?? undefined,
    sort: sortParam(sp, SORTS),
    page,
    pageSize,
  });

  const hiddenFields = await hiddenFieldsFor(sessionFieldViewer(user), 'companies');
  return NextResponse.json({ rows: rows.map((r) => redactRow(r, hiddenFields)), total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = companyCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const fp = await guardRecordCustomWrite(sessionFieldViewer(user), 'company', null, parsed.data.custom);
  if (!fp.ok) return crmError(403, 'field_readonly');
  const data = { ...parsed.data, custom: fp.custom, ownerId: parsed.data.ownerId ?? realUserId(user) };
  // Las obligatorias del formulario de alta (Ajustes › Datos), solo para las altas desde ese formulario.
  if (isCreateFormRequest(body)) {
    const missing = await createFormMissing(sessionFieldViewer(user), 'companies', data);
    if (missing.fields.length) return NextResponse.json({ error: 'missing_required', ...missing }, { status: 400 });
  }
  const company = await catchRef(createCompany(user.id, data));
  if (company instanceof CrmRefError) return crmError(400, company.code);
  // Datos del sitio en segundo plano (lo que el formulario no precargó).
  if (shouldEnrichOnCreate(company)) {
    const companyId = company.id;
    after(() => enrichCompany(user.id, companyId, { actorEmail: user.actingUser?.email ?? user.email }).then(() => undefined).catch(() => undefined));
  }
  return NextResponse.json(company, { status: 201 });
}
