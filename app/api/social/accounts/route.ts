import { NextResponse } from 'next/server';
import { withSocial } from '@/lib/social-http';
import { listAccounts, networkStatuses } from '@/lib/social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cuentas que ve la persona (sin tokens) y qué redes configuró el admin de la instancia. */
export async function GET() {
  return withSocial(async ({ actor }) => NextResponse.json({ accounts: await listAccounts(actor), networks: networkStatuses() }));
}
