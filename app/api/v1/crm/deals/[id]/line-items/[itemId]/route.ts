import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { deleteLineItem, updateLineItem } from '@/lib/crm-products';
import { lineItemUpdateSchema } from '@/lib/crm-schema';
import { catchRef, cleanRow, CrmRefError, zodErrorCode } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id, itemId } = await props.params;
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = lineItemUpdateSchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');

  const item = await catchRef(updateLineItem(auth.user.id, id, itemId, parsed.data));
  if (item instanceof CrmRefError) {
    if (item.code === 'invalid_deal') return apiError(404, 'not_found', 'Deal not found.');
    return apiError(400, item.code, 'The request body is not valid.');
  }
  if (!item) return apiError(404, 'not_found', 'Line item not found.');
  return NextResponse.json(cleanRow(item));
}

export async function DELETE(req: NextRequest, props: Ctx) {
  const { id, itemId } = await props.params;
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const ok = await catchRef(deleteLineItem(auth.user.id, id, itemId));
  if (ok instanceof CrmRefError || !ok) return apiError(404, 'not_found', 'Line item not found.');
  return new NextResponse(null, { status: 204 });
}
