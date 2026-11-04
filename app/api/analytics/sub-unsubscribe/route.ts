import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { confirmRecipient, unsubscribe } from '@/lib/analytics/subscriptions';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Dejar de recibir o confirmar una suscripción, con el token del email. Es un POST: un GET no cambia nada.
 * El clic de "cancelar" de los clientes de correo (List-Unsubscribe-Post) trae el token en la URL.
 */
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'asub-unsub', 30, 600);
  if (limited) return limited;
  const inUrl = req.nextUrl.searchParams.get('t');
  if (inUrl) return (await unsubscribe(inUrl)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  const parsed = z.object({ token: z.string().max(600).optional(), confirm: z.string().max(700).optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  const ok = parsed.data.confirm ? await confirmRecipient(parsed.data.confirm) : parsed.data.token ? await unsubscribe(parsed.data.token) : false;
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'invalid_token' }, { status: 400 });
}
