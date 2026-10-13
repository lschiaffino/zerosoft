import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteExchangeRate, listExchangeRates, setExchangeRate } from '@/lib/crm-currency';
import { exchangeRateSchema } from '@/lib/crm-schema';
import { cleanRow, crmError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: (await listExchangeRates(user.id)).map(cleanRow) });
}

/** Crea o actualiza el tipo de cambio de una moneda a la base (solo admins). */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const body: unknown = await req.json().catch(() => null);
  const parsed = exchangeRateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    return NextResponse.json(cleanRow(await setExchangeRate(user.id, parsed.data.currency, parsed.data.rate)));
  } catch (e) {
    return crmError(400, e instanceof Error && e.message === 'invalid_rate' ? 'invalid_rate' : 'invalid_currency');
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const currency = req.nextUrl.searchParams.get('currency') ?? '';
  if (!/^[A-Za-z]{3}$/.test(currency)) return crmError(400, 'invalid_currency');
  if (!(await deleteExchangeRate(user.id, currency))) return notFound();
  return new NextResponse(null, { status: 204 });
}
