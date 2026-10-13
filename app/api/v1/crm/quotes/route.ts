import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { createQuote, listQuotes } from '@/lib/crm-products';
import { quoteCreateSchema } from '@/lib/crm-schema';
import { QUOTE_STATUSES, type QuoteStatus } from '@/lib/crm-constants';
import { catchRef, CrmRefError, pageParams, zodErrorCode } from '@/lib/crm-http';
import { publicOrigin, serializeQuote } from './serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const statusParam = sp.get('status');
  const status = (QUOTE_STATUSES as readonly string[]).includes(statusParam ?? '')
    ? (statusParam as QuoteStatus)
    : undefined;
  const { rows, total } = await listQuotes(auth.user.id, {
    dealId: sp.get('dealId') ?? undefined,
    status,
    page,
    pageSize,
  });
  const origin = publicOrigin(req);
  return NextResponse.json({ quotes: rows.map((q) => serializeQuote(q, origin)), total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = quoteCreateSchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');

  const { dealId, ...data } = parsed.data;
  const result = await catchRef(createQuote(auth.user.id, dealId, data, auth.user.id));
  if (result instanceof CrmRefError) return apiError(400, 'invalid_deal', 'The deal does not exist.');
  if (!result.ok) return apiError(400, 'no_line_items', 'Add line items to the deal before creating a quote.');
  return NextResponse.json(serializeQuote(result.quote, publicOrigin(req)), { status: 201 });
}
