import { NextRequest, NextResponse } from 'next/server';
import { isRateLimited, limitByIp, rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';
import { gateCookieName, gateToken, getLinkForHost, verifyPassword } from '@/lib/links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  slug: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'gate', 30, 60);
  if (limited) return limited;
  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const { slug, password } = parsed.data;
  // Fuerza bruta sobre un link puntual: 5 intentos por minuto por IP y slug.
  const perLink = await limitByIp(req, 'gate-slug', 5, 60, slug);
  if (perLink) return perLink;
  const link = await getLinkForHost(req.headers.get('host'), slug);
  if (!link || !link.password_hash) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Tope por link para todas las IPs juntas: muchas IPs en paralelo no adivinan la contraseña.
  const failKey = `gate-fail:${link.id}`;
  if (await isRateLimited(failKey, 50, 3600)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  if (!(await verifyPassword(password, link.password_hash))) {
    await rateLimit(failKey, 50, 3600);
    return NextResponse.json({ error: 'wrong_password' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, redirect: `/${slug}` });
  res.cookies.set(gateCookieName(slug), gateToken(slug, link.password_hash), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return res;
}
