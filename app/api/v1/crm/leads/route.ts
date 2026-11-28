import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { apiScope, canSeeEntity, type OwnerScope } from '@/lib/crm-visibility';
import { createLead, listLeads } from '@/lib/crm-leads';
import { leadCreateSchema } from '@/lib/crm-schema';
import { catchRef, cleanRow, CrmRefError, pageParams, zodErrorCode } from '@/lib/crm-http';
import { apiFieldViewer, guardCustomWrite, hiddenFieldsFor, redactRow } from '@/lib/crm-field-perms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['open', 'qualified', 'disqualified'] as const;

async function refsVisible(ws: string, sp: URLSearchParams, scope: OwnerScope): Promise<boolean> {
  const contactId = sp.get('contactId');
  const companyId = sp.get('companyId');
  if (contactId && !(await canSeeEntity(ws, 'contact', contactId, scope))) return false;
  if (companyId && !(await canSeeEntity(ws, 'company', companyId, scope))) return false;
  return true;
}

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const status = sp.get('status');
  const scope = await apiScope(auth);
  // Filtrar por un contacto o una empresa que la key no ve no lista nada (no dice qué leads tiene).
  if (!(await refsVisible(auth.user.id, sp, scope))) return NextResponse.json({ leads: [], total: 0, page, pageSize });
  const { rows, total } = await listLeads(auth.user.id, {
    ownerScope: scope,
    q: sp.get('q') ?? undefined,
    stageId: sp.get('stageId') ?? undefined,
    contactId: sp.get('contactId') ?? undefined,
    companyId: sp.get('companyId') ?? undefined,
    status: (STATUSES as readonly string[]).includes(status ?? '') ? (status as (typeof STATUSES)[number]) : undefined,
    page,
    pageSize,
  });
  const hidden = await hiddenFieldsFor(apiFieldViewer(auth), 'leads');
  return NextResponse.json({ leads: rows.map((r) => cleanRow(redactRow(r, hidden))), total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const parsed = leadCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  const scope = await apiScope(auth);
  if (parsed.data.contactId && !(await canSeeEntity(auth.user.id, 'contact', parsed.data.contactId, scope))) {
    return apiError(400, 'invalid_contact', 'A referenced record does not exist.');
  }
  if (parsed.data.companyId && !(await canSeeEntity(auth.user.id, 'company', parsed.data.companyId, scope))) {
    return apiError(400, 'invalid_company', 'A referenced record does not exist.');
  }
  const guard = await guardCustomWrite(apiFieldViewer(auth), 'leads', '{}', parsed.data.custom);
  if (!guard.ok) return apiError(403, 'field_readonly', 'A property in the body is read-only for this key.');
  const lead = await catchRef(createLead(auth.user.id, { ...parsed.data, custom: guard.custom, ownerId: parsed.data.ownerId ?? auth.personId }));
  if (lead instanceof CrmRefError) return apiError(400, lead.code, 'A referenced record does not exist or a field is missing.');
  return NextResponse.json(cleanRow(redactRow(lead, await hiddenFieldsFor(apiFieldViewer(auth), 'leads'))), { status: 201 });
}
