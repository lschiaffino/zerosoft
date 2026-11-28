import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { setBriefEmail } from '@/lib/daily-brief';
import { parseBriefUnsubscribeToken } from '@/lib/daily-brief-unsub';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Baja del email del resumen del día con el token firmado del email (sin sesión; lib/daily-brief-unsub.ts). Es un
 * POST: abrir el link (la página de confirmación) no cambia nada. El clic único de los clientes de correo
 * (List-Unsubscribe-Post, RFC 8058) trae el token en la URL; la página lo manda en el cuerpo. Solo apaga el email;
 * la tarjeta sigue en Lines e Inbox.
 */
export async function POST(req: NextRequest) {
  let token: unknown = req.nextUrl.searchParams.get('t');
  if (!token) {
    const parsed = z.object({ token: z.string().max(400) }).safeParse(await req.json().catch(() => null));
    token = parsed.success ? parsed.data.token : null;
  }
  // El límite cuenta solo los intentos con un token que no sirve: los clics únicos llegan desde servidores
  // compartidos de los correos (muchas bajas buenas desde la misma IP) y uno válido se puede repetir sin daño.
  const invalid = async () => (await limitByIp(req, 'daily-brief-unsub', 30, 600)) ?? NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  const parsed = parseBriefUnsubscribeToken(token);
  if (!parsed) return invalid();
  const user = await getDb().prepare('SELECT id FROM users WHERE id = ?').get(parsed.userId);
  if (!user) return invalid();
  await setBriefEmail(parsed.userId, false);
  return NextResponse.json({ ok: true });
}
