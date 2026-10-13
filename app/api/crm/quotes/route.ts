import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { createQuote, listQuotes } from '@/lib/crm-products';
import { QUOTE_STATUSES, type QuoteStatus } from '@/lib/crm-constants';
import { quoteCreateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, pageParams, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const status = sp.get('status') ?? '';
  const { rows, total } = await listQuotes(user.id, {
    dealId: sp.get('dealId') ?? undefined,
    status: (QUOTE_STATUSES as readonly string[]).includes(status) ? (status as QuoteStatus) : undefined,
    page,
    pageSize,
  });
  return NextResponse.json({ rows, total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = quoteCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const { dealId, ...data } = parsed.data;
  const result = await catchRef(createQuote(user.id, dealId, data, realUserId(user)));
  if (result instanceof CrmRefError) return crmError(400, result.code);
  if (!result.ok) return crmError(400, result.error);
  return NextResponse.json(result.quote, { status: 201 });
}
