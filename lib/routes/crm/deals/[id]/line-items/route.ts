import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { addLineItem, listLineItems } from '@/lib/crm-products';
import { lineItemCreateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized, guardRecord } from '@/lib/crm-http';
import { sessionScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'deal', id, scope);
  if (hidden) return hidden;
  const summary = await listLineItems(user.id, id);
  if (!summary) return notFound();
  return NextResponse.json(summary);
}

export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'deal', id, scope);
  if (hidden) return hidden;
  const body: unknown = await req.json().catch(() => null);
  const parsed = lineItemCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const item = await catchRef(addLineItem(user.id, id, parsed.data));
  if (item instanceof CrmRefError) {
    return item.code === 'invalid_deal' ? notFound() : crmError(400, item.code);
  }
  return NextResponse.json(item, { status: 201 });
}
