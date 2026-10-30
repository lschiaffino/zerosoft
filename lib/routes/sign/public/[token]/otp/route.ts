import { NextRequest } from 'next/server';
import { z } from 'zod';
import { sendOtp, SESSION_TTL_MS, sessionCookieName, verifyOtp } from '@/lib/sign/signing';
import { OTP_VERIFY_IP_LIMIT, OTP_VERIFY_WINDOW_SEC } from '@/lib/sign/types';
import { publicResolve, type PublicCtx } from '@/lib/sign/public-http';
import { metaOf, parseBody, sFail, signLimit, sJson } from '@/lib/sign/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [z.object({ action: z.literal('send') }), z.object({ action: z.literal('verify'), code: z.string().max(12) })]);

/**
 * POST { action: 'send' }: manda el código al email del destinatario (tope por
 * destinatario y por IP). { action: 'verify', code }: lo verifica (5 intentos
 * por código y tope por IP) y abre la sesión de dos horas en una cookie.
 */
export async function POST(req: NextRequest, ctx: PublicCtx) {
  const p = await publicResolve(req, ctx, 'otp', 30);
  if ('res' in p) return p.res;
  try {
    const input = await parseBody(req, schema);
    if (input.action === 'send') {
      const limited = await signLimit(req, 'otp-send-ip', 10, 3600);
      if (limited) return limited;
      return sJson({ sent: true, ...(await sendOtp(p.r, metaOf(req))) });
    }
    const limited = await signLimit(req, 'otp-verify-ip', OTP_VERIFY_IP_LIMIT, OTP_VERIFY_WINDOW_SEC);
    if (limited) return limited;
    const session = await verifyOtp(p.r, input.code, metaOf(req));
    const res = sJson({ ok: true });
    res.cookies.set(sessionCookieName(p.r.recipient.id), session, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production' && (process.env.NEXTAUTH_URL ?? '').startsWith('https://'),
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return res;
  } catch (err) {
    return sFail(err);
  }
}
