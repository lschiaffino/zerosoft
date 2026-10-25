import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { searchCrmCustomers } from '@/lib/track-customers';
import { unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Empresas y contactos del CRM para elegir el cliente de un pedido. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 100);
  return NextResponse.json({ rows: await searchCrmCustomers(user.id, q, await sessionScope(user)) });
}
