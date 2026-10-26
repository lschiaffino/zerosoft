import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canSeeOwner, sessionScope } from '@/lib/crm-visibility';
import { convertLead, getLead } from '@/lib/crm-leads';
import { leadConvertSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Convierte el lead en deal (con contacto, empresa, owner y fuente del lead). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const lead = await getLead(user.id, id);
  if (!lead || !canSeeOwner(await sessionScope(user), lead.owner_id, user.id)) return notFound();
  const parsed = leadConvertSchema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await catchRef(convertLead(user.id, id, parsed.data));
  if (res instanceof CrmRefError) return crmError(400, res.code);
  if (!res.ok) return res.reason === 'not_found' ? notFound() : crmError(res.reason === 'already_converted' || res.reason === 'lead_disqualified' ? 409 : 400, res.reason);
  return NextResponse.json({ dealId: res.dealId }, { status: 201 });
}
