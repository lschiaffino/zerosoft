import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { getDeal, updateDeal } from '@/lib/crm';
import { dealUpdateSchema } from '@/lib/crm-schema';
import { cleanRow, zodErrorCode } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const detail = await getDeal(auth.user.id, params.id);
  if (!detail) return apiError(404, 'not_found', 'Deal not found.');
  return NextResponse.json(cleanRow(detail.deal));
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = dealUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  }

  const deal = await updateDeal(auth.user.id, params.id, parsed.data, auth.user.email);
  if (!deal) return apiError(404, 'not_found', 'Deal not found.');
  return NextResponse.json(cleanRow(deal));
}
