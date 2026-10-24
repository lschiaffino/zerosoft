import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, type SessionUser } from '@/lib/session';
import { canSeeEntity, canSeeOwner, sessionScope } from '@/lib/crm-visibility';
import { deleteLead, getLead, updateLead } from '@/lib/crm-leads';
import { leadUpdateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import { guardCustomWrite, hiddenFieldsFor, redactRow, sessionFieldViewer } from '@/lib/crm-field-perms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function visibleLead(user: SessionUser, id: string) {
  const lead = await getLead(user.id, id);
  if (!lead || !canSeeOwner(await sessionScope(user), lead.owner_id, user.id)) return null;
  return lead;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const lead = await visibleLead(user, id);
  if (!lead) return notFound();
  return NextResponse.json(redactRow(lead, await hiddenFieldsFor(sessionFieldViewer(user), 'leads')));
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const lead = await visibleLead(user, id);
  if (!lead) return notFound();
  const parsed = leadUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const scope = await sessionScope(user);
  if (parsed.data.contactId && !(await canSeeEntity(user.id, 'contact', parsed.data.contactId, scope))) return notFound();
  if (parsed.data.companyId && !(await canSeeEntity(user.id, 'company', parsed.data.companyId, scope))) return notFound();
  const viewer = sessionFieldViewer(user);
  const guard = await guardCustomWrite(viewer, 'leads', lead.custom, parsed.data.custom);
  if (!guard.ok) return crmError(403, 'field_readonly');
  const updated = await catchRef(updateLead(user.id, id, { ...parsed.data, custom: guard.custom }));
  if (updated instanceof CrmRefError) return crmError(400, updated.code);
  if (!updated) return notFound();
  return NextResponse.json(redactRow(updated, await hiddenFieldsFor(viewer, 'leads')));
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await visibleLead(user, id))) return notFound();
  await deleteLead(user.id, id);
  return new NextResponse(null, { status: 204 });
}
