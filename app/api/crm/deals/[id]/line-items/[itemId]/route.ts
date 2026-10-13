import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteLineItem, updateLineItem } from '@/lib/crm-products';
import { lineItemUpdateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized, guardRecord } from '@/lib/crm-http';
import { sessionScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id, itemId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'deal', id, scope);
  if (hidden) return hidden;
  const body: unknown = await req.json().catch(() => null);
  const parsed = lineItemUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const item = await catchRef(updateLineItem(user.id, id, itemId, parsed.data));
  if (item instanceof CrmRefError) {
    return item.code === 'invalid_deal' ? notFound() : crmError(400, item.code);
  }
  if (!item) return notFound();
  return NextResponse.json(item);
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id, itemId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'deal', id, scope);
  if (hidden) return hidden;
  const ok = await catchRef(deleteLineItem(user.id, id, itemId));
  if (ok instanceof CrmRefError || !ok) return notFound();
  return new NextResponse(null, { status: 204 });
}
