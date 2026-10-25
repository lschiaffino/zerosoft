import { NextResponse } from 'next/server';
import { voiceAuth } from '@/lib/voice-route';
import { listLinkableBookings } from '@/lib/voice-integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reservas de Cal confirmadas (últimos 14 días y próximos 7) para vincular a una reunión. */
export async function GET() {
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  const bookings = await listLinkableBookings(auth.owner).catch(() => []);
  return NextResponse.json({ bookings });
}
