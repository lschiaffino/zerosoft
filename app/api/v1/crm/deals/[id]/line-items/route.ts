import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { addLineItem, listLineItems } from '@/lib/crm-products';
import { lineItemCreateSchema } from '@/lib/crm-schema';
import { catchRef, cleanRow, CrmRefError, zodErrorCode, apiGuardRecord } from '@/lib/crm-http';
import { apiScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const hidden = await apiGuardRecord(auth.user.id, 'deal', id, await apiScope(auth));
  if (hidden) return hidden;

  const summary = await listLineItems(auth.user.id, id);
  if (!summary) return apiError(404, 'not_found', 'Deal not found.');
  return NextResponse.json({ ...summary, items: summary.items.map(cleanRow) });
}

export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const hidden = await apiGuardRecord(auth.user.id, 'deal', id, await apiScope(auth));
  if (hidden) return hidden;

  const body: unknown = await req.json().catch(() => null);
  const parsed = lineItemCreateSchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');

  const item = await catchRef(addLineItem(auth.user.id, id, parsed.data));
  if (item instanceof CrmRefError) {
    if (item.code === 'invalid_deal') return apiError(404, 'not_found', 'Deal not found.');
    if (item.code === 'missing_name') return apiError(400, 'missing_name', 'A custom line item needs a name.');
    return apiError(400, item.code, 'A referenced record does not exist.');
  }
  return NextResponse.json(cleanRow(item), { status: 201 });
}
