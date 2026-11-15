import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getUserLook, setUserLook } from '@/lib/look-server';
import { isLook, LOOK_COOKIE, LOOK_COOKIE_MAX_AGE } from '@/lib/look';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'private, no-store' };

/** El aspecto de la interfaz de la persona (Ajustes › Apariencia). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  return NextResponse.json({ look: await getUserLook(realUserId(user)) }, { headers: NO_STORE });
}

/** { look: 'lines' | 'classic' | 'liquid' }. Lo guarda en users.look y en la cookie de este navegador. */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  const id = realUserId(user);
  const limit = await rateLimit(`look:${id}`, 60, 600);
  if (!limit.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: NO_STORE });
  const body = (await req.json().catch(() => null)) as { look?: unknown } | null;
  if (!body || !isLook(body.look)) return NextResponse.json({ error: 'invalid_input' }, { status: 400, headers: NO_STORE });
  await setUserLook(id, body.look);
  const res = NextResponse.json({ look: body.look }, { headers: NO_STORE });
  res.cookies.set(LOOK_COOKIE, body.look, { path: '/', maxAge: LOOK_COOKIE_MAX_AGE, sameSite: 'lax' });
  return res;
}
