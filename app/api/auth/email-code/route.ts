import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { emailLoginEnabled, normalizeLoginEmail, sendLoginCode } from '@/lib/email-login';
import { limitByIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().max(320), locale: z.enum(['en', 'es', 'pt']).optional() });

/**
 * POST { email, locale }: manda un código de 6 dígitos para entrar (lib/email-login.ts).
 * Responde lo mismo exista o no la cuenta. El canje lo hace NextAuth
 * (signIn('email-code', { email, code })).
 */
export async function POST(req: NextRequest) {
  if (!emailLoginEnabled()) return NextResponse.json({ error: 'email_login_disabled' }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  const email = parsed.success ? normalizeLoginEmail(parsed.data.email) : null;
  if (!parsed.success || !email) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  const byIp = await limitByIp(req, 'auth:email-code', 20, 900);
  if (byIp) return byIp;
  const byEmail = await rateLimit(`auth:email-code:${email}`, 5, 900);
  if (!byEmail.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const res = await sendLoginCode(email, parsed.data.locale);
  if (!res.ok) return NextResponse.json({ error: 'send_failed' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
