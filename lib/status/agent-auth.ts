import { createHash, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';

/**
 * Auth de la API del watcher (/api/status/*): `Authorization: Bearer
 * <STATUS_AGENT_TOKEN>`. Comparación en tiempo constante sobre el SHA-256 de
 * los dos lados (mismo largo siempre). El token nunca se loguea ni vuelve en
 * una respuesta. Sin la variable, la API no existe (503), también en desarrollo.
 */
export function agentAuthError(req: Request): NextResponse | null {
  const secret = process.env.STATUS_AGENT_TOKEN?.trim();
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  const given = m ? m[1] : '';
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(secret).digest();
  if (!given || !timingSafeEqual(a, b)) {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'www-authenticate': 'Bearer realm="status"', 'cache-control': 'no-store' } },
    );
  }
  return null;
}

/** Auth de los crons (CRON_SECRET como Bearer), igual que /api/calendar/reminders/due. */
export function cronAuthError(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'cron_secret_not_configured' }, { status: 503 });
  }
  if (secret) {
    const header = req.headers.get('authorization') ?? '';
    const a = createHash('sha256').update(header).digest();
    const b = createHash('sha256').update(`Bearer ${secret}`).digest();
    if (!timingSafeEqual(a, b)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
