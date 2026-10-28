import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { flowStats } from '@/lib/flow-monitor';
import { unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tablero de uso y fallas (?days=1|7|30|90) y la cola actual. Sin datos de corridas. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ stats: await flowStats(user.id, Number(req.nextUrl.searchParams.get('days')) || 7) });
}
