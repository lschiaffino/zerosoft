import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { applyUnsubscribe, parseUnsubscribeToken } from '@/lib/lifecycle/prefs';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Baja de los emails de ciclo de vida con el token del link (sin sesión).
 * Es un POST: abrir el link (GET de la página) no cambia nada. El one-click
 * de los clientes de correo (List-Unsubscribe-Post, RFC 8058) trae el token
 * en la URL; la página de confirmación lo manda en el cuerpo.
 */
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'lifecycle-unsub', 30, 600);
  if (limited) return limited;
  let token: unknown = req.nextUrl.searchParams.get('t');
  if (!token) {
    const parsed = z.object({ token: z.string().max(400) }).safeParse(await req.json().catch(() => null));
    token = parsed.success ? parsed.data.token : null;
  }
  const parsed = parseUnsubscribeToken(token);
  if (!parsed) return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  const prefs = await applyUnsubscribe(parsed.userId, parsed.scope);
  if (!prefs) return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  return NextResponse.json({ ok: true, scope: parsed.scope });
}
