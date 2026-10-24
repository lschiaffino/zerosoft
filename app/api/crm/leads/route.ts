import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canSeeEntity, sessionScope } from '@/lib/crm-visibility';
import { createLead, listLeads } from '@/lib/crm-leads';
import { leadCreateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, pageParams, unauthorized } from '@/lib/crm-http';
import { guardCustomWrite, hiddenFieldsFor, redactRow, sessionFieldViewer } from '@/lib/crm-field-perms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SORTS = ['newest', 'oldest', 'name', 'last_activity'] as const;
const STATUSES = ['open', 'qualified', 'disqualified'] as const;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const sort = sp.get('sort');
  const status = sp.get('status');
  const { rows, total } = await listLeads(user.id, {
    ownerScope: await sessionScope(user),
    q: sp.get('q') ?? undefined,
    stageId: sp.get('stageId') ?? undefined,
    owner: sp.get('owner') ?? undefined,
    contactId: sp.get('contactId') ?? undefined,
    companyId: sp.get('companyId') ?? undefined,
    status: (STATUSES as readonly string[]).includes(status ?? '') ? (status as (typeof STATUSES)[number]) : undefined,
    sort: (SORTS as readonly string[]).includes(sort ?? '') ? (sort as (typeof SORTS)[number]) : undefined,
    page,
    pageSize,
  });
  const hidden = await hiddenFieldsFor(sessionFieldViewer(user), 'leads');
  return NextResponse.json({ rows: rows.map((r) => redactRow(r, hidden)), total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = leadCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const scope = await sessionScope(user);
  // No se cuelga un lead de un contacto o empresa que la persona no ve.
  if (parsed.data.contactId && !(await canSeeEntity(user.id, 'contact', parsed.data.contactId, scope))) return notFound();
  if (parsed.data.companyId && !(await canSeeEntity(user.id, 'company', parsed.data.companyId, scope))) return notFound();
  const guard = await guardCustomWrite(sessionFieldViewer(user), 'leads', '{}', parsed.data.custom);
  if (!guard.ok) return crmError(403, 'field_readonly');
  const lead = await catchRef(createLead(user.id, { ...parsed.data, custom: guard.custom, ownerId: parsed.data.ownerId ?? realUserId(user) }));
  if (lead instanceof CrmRefError) return crmError(400, lead.code);
  return NextResponse.json(lead, { status: 201 });
}
