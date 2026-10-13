import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';
import { rateLimit } from './rate-limit';

/**
 * Rate limit de escrituras autenticadas (por persona, no por IP): frena
 * scripts que abusen de la API sin molestar al autosave normal.
 * Devuelve un 429 listo para retornar, o null si puede seguir.
 */
export async function limitWrites(
  bucket: string,
  key: string,
  limit = 240,
  windowSec = 60,
): Promise<NextResponse | null> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return null;
  const res = await rateLimit(`${bucket}:${key}`, limit, windowSec);
  if (res.ok) return null;
  return NextResponse.json(
    { error: 'rate_limited' },
    { status: 429, headers: { 'retry-after': String(Math.max(1, Math.ceil((res.resetAt - Date.now()) / 1000))) } },
  );
}

export function jsonError(status: number, code: string): NextResponse {
  return NextResponse.json({ error: code }, { status });
}

export function invalidInput(_error?: ZodError): NextResponse {
  return jsonError(400, 'invalid_input');
}
