import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { unsubscribe } from '@/lib/analytics/subscriptions';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Dejar de recibir una suscripción, con el token del email. Es un POST: un GET no cambia nada. */
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'asub-unsub', 30, 600);
  if (limited) return limited;
  const parsed = z.object({ token: z.string().max(600) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success || !(await unsubscribe(parsed.data.token))) return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
