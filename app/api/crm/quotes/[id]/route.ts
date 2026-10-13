import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canSeeQuote, sessionScope } from '@/lib/crm-visibility';
import { deleteQuote, getQuote, markQuoteSent, updateQuote } from '@/lib/crm-products';
import { quoteUpdateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await canSeeQuote(user.id, id, await sessionScope(user)))) return notFound();
  const quote = await getQuote(user.id, id);
  if (!quote) return notFound();
  return NextResponse.json(quote);
}

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await canSeeQuote(user.id, id, await sessionScope(user)))) return notFound();
  const body: unknown = await req.json().catch(() => null);
  const parsed = quoteUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const { status, ...data } = parsed.data;
  // Primero los campos (solo borradores), después la publicación (draft → sent).
  if (Object.values(data).some((v) => v !== undefined)) {
    const res = await catchRef(updateQuote(user.id, id, data));
    if (res instanceof CrmRefError) return crmError(400, res.code);
    if (!res.ok) {
      if (res.error === 'not_found') return notFound();
      return crmError(res.error === 'not_draft' ? 409 : 400, res.error);
    }
    if (!status) return NextResponse.json(res.quote);
  }
  if (status === 'sent') {
    const res = await markQuoteSent(user.id, id);
    if (!res.ok) return res.error === 'not_found' ? notFound() : crmError(409, res.error);
    return NextResponse.json(res.quote);
  }
  const quote = await getQuote(user.id, id);
  if (!quote) return notFound();
  return NextResponse.json(quote);
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await canSeeQuote(user.id, id, await sessionScope(user)))) return notFound();
  if (!(await deleteQuote(user.id, id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
