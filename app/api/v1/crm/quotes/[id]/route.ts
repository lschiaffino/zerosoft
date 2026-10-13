import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { getQuote, markQuoteSent, updateQuote, type QuoteUpdateResult } from '@/lib/crm-products';
import { quoteUpdateSchema } from '@/lib/crm-schema';
import { zodErrorCode } from '@/lib/crm-http';
import { publicOrigin, serializeQuote } from '../serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;
  const quote = await getQuote(auth.user.id, id);
  if (!quote) return apiError(404, 'not_found', 'Quote not found.');
  return NextResponse.json(serializeQuote(quote, publicOrigin(req)));
}

/** Edita un borrador; `status: 'sent'` lo publica (draft → sent). */
export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = quoteUpdateSchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');

  const { status, ...fields } = parsed.data;
  let result: QuoteUpdateResult = { ok: false, error: 'not_found' };
  const hasFields = Object.values(fields).some((v) => v !== undefined);
  if (hasFields || !status) {
    result = await updateQuote(auth.user.id, id, fields);
    if (!result.ok) return quoteError(result.error);
  }
  if (status === 'sent') {
    result = await markQuoteSent(auth.user.id, id);
    if (!result.ok) return quoteError(result.error);
  }
  if (!result.ok) return quoteError(result.error);
  return NextResponse.json(serializeQuote(result.quote, publicOrigin(req)));
}

function quoteError(code: 'not_found' | 'not_draft' | 'no_line_items'): NextResponse {
  if (code === 'not_found') return apiError(404, 'not_found', 'Quote not found.');
  if (code === 'not_draft') return apiError(409, 'not_draft', 'Only draft quotes can be edited or sent.');
  return apiError(400, 'no_line_items', 'The deal has no line items.');
}
