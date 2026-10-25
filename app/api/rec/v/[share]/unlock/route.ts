import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPublicVideoRow, unlockCookieName, unlockToken, verifyPassword } from '@/lib/rec';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ password: z.string().min(1).max(200) });

/** Contraseña de un video: con la correcta deja una cookie firmada (cambia si cambia la contraseña). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ share: string }> }) {
  const limited = await limitByIp(req, 'rec:unlock', 20, 600);
  if (limited) return limited;
  const { share } = await ctx.params;
  const v = await getPublicVideoRow(share);
  if (!v) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  if (!v.password_hash) return NextResponse.json({ ok: true });
  if (!(await verifyPassword(parsed.data.password, v.password_hash))) return NextResponse.json({ error: 'wrong_password' }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(unlockCookieName(v.share_id), unlockToken(v), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 30 * 86400,
  });
  return res;
}
