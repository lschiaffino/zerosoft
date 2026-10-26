import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireApiUser, type ApiKeyAuth } from '@/lib/api-auth';
import { apiScope, canSeeEntity, canSeeOwner } from '@/lib/crm-visibility';
import { deleteLead, getLead, updateLead } from '@/lib/crm-leads';
import { leadUpdateSchema } from '@/lib/crm-schema';
import { catchRef, cleanRow, CrmRefError, zodErrorCode } from '@/lib/crm-http';
import { apiFieldViewer, guardCustomWrite, hiddenFieldsFor, redactRow } from '@/lib/crm-field-perms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function visibleLead(auth: ApiKeyAuth, id: string) {
  const lead = await getLead(auth.user.id, id);
  if (!lead || !canSeeOwner(await apiScope(auth), lead.owner_id, auth.user.id)) return null;
  return lead;
}

const notFound = () => apiError(404, 'not_found', 'Lead not found.');

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const lead = await visibleLead(auth, id);
  if (!lead) return notFound();
  return NextResponse.json(cleanRow(redactRow(lead, await hiddenFieldsFor(apiFieldViewer(auth), 'leads'))));
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const lead = await visibleLead(auth, id);
  if (!lead) return notFound();
  const parsed = leadUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  const scope = await apiScope(auth);
  if (parsed.data.contactId && !(await canSeeEntity(auth.user.id, 'contact', parsed.data.contactId, scope))) {
    return apiError(400, 'invalid_contact', 'A referenced record does not exist.');
  }
  if (parsed.data.companyId && !(await canSeeEntity(auth.user.id, 'company', parsed.data.companyId, scope))) {
    return apiError(400, 'invalid_company', 'A referenced record does not exist.');
  }
  const viewer = apiFieldViewer(auth);
  const guard = await guardCustomWrite(viewer, 'leads', lead.custom, parsed.data.custom);
  if (!guard.ok) return apiError(403, 'field_readonly', 'A property in the body is read-only for this key.');
  const updated = await catchRef(updateLead(auth.user.id, id, { ...parsed.data, custom: guard.custom }));
  if (updated instanceof CrmRefError) return apiError(400, updated.code, 'A referenced record does not exist.');
  if (!updated) return notFound();
  return NextResponse.json(cleanRow(redactRow(updated, await hiddenFieldsFor(viewer, 'leads'))));
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  if (!(await visibleLead(auth, id))) return notFound();
  await deleteLead(auth.user.id, id);
  return new NextResponse(null, { status: 204 });
}
