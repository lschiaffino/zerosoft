import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { dismissDesktopHint } from '@/lib/desktop-hint';
import { trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cerrar la tarjeta de la app de escritorio del inicio ({ dismiss: true }). Idempotente. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!req.headers.get('content-type')?.includes('application/json')) return trackError(415, 'json_required');
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || (body as { dismiss?: unknown }).dismiss !== true) return trackError(400, 'invalid_body');
  await dismissDesktopHint(realUserId(user));
  return NextResponse.json({ ok: true });
}
