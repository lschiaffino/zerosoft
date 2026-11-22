import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { addListMembers, getList, removeListMember } from '@/lib/crm';
import { listMembersSchema } from '@/lib/crm-schema';
import { crmError, notFound, unauthorized } from '@/lib/crm-http';
import { canSeeRecord, sessionScope, visibleIds } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const removeSchema = z.object({ contactId: z.string().min(1).max(64) });

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = listMembersSchema.safeParse(body);
  if (!parsed.success) return crmError(400, 'invalid_input');

  if (!(await getList(user.id, params.id))) return notFound();
  // Solo contactos que la persona ve.
  const ids = await visibleIds(user.id, 'crm_contacts', parsed.data.contactIds, await sessionScope(user));
  const added = await addListMembers(user.id, params.id, ids);
  return NextResponse.json({ count: added });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = removeSchema.safeParse(body);
  if (!parsed.success) return crmError(400, 'invalid_input');

  if (!(await getList(user.id, params.id))) return notFound();
  if (!(await canSeeRecord(user.id, 'crm_contacts', parsed.data.contactId, await sessionScope(user)))) return notFound();
  if (!(await removeListMember(user.id, params.id, parsed.data.contactId))) return notFound();
  return new NextResponse(null, { status: 204 });
}
