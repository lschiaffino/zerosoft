import { NextRequest } from 'next/server';
import { z } from 'zod';
import { clearEmail, createSession, loadSession, recordDenied, SESSION_MAX_AGE, submitEmail, submitPasscode, viewerState } from '@/lib/send/viewer';
import { parseBody, publicLink, sendLimit, sFail, sJson, type PublicCtx } from '@/lib/send/http';
import { linkState, sessionCookie } from '@/lib/send/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  passcode: z.string().max(100).optional(),
  email: z.string().max(254).optional(),
  /** Volver atrás desde el código o desde "sin acceso", para escribir otro email. */
  resetEmail: z.boolean().optional(),
});

/** GET: en qué paso está esta sesión. Solo lee. */
export async function GET(req: NextRequest, ctx: PublicCtx) {
  const p = await publicLink(req, (await ctx.params).token);
  if ('res' in p) return p.res;
  const limited = await sendLimit(req, 'state', 120, 60);
  if (limited) return limited;
  return sJson(await viewerState(p.link, await loadSession(p.link, p.cookie)));
}

/**
 * POST: abre la sesión y avanza un paso (código, email). El GET de la página no
 * crea nada: esto lo llama el navegador, no un previsualizador de links.
 */
export async function POST(req: NextRequest, ctx: PublicCtx) {
  const p = await publicLink(req, (await ctx.params).token);
  if ('res' in p) return p.res;
  const limited = await sendLimit(req, 'open', 60, 60);
  if (limited) return limited;
  try {
    const input = await parseBody(req, schema);
    if (linkState(p.link) !== 'active') return sJson(await viewerState(p.link, null));
    let session = await loadSession(p.link, p.cookie);
    let setCookie: string | null = null;
    if (!session) {
      const made = await createSession(p.link);
      session = made.session;
      setCookie = made.cookie;
    }
    if (input.passcode !== undefined) await submitPasscode(p.link, session, input.passcode, p.ip);
    if (input.resetEmail) await clearEmail(session);
    if (input.email !== undefined) {
      const fresh = await loadSession(p.link, setCookie ?? p.cookie);
      // Sin pasar el código no se prueba ningún email.
      if (p.link.passcode_hash && !fresh?.passcode_ok) return sJson({ error: 'passcode_required' }, 401);
      await submitEmail(p.link, session, input.email);
    }
    const fresh = await loadSession(p.link, setCookie ?? p.cookie);
    const state = await viewerState(p.link, fresh);
    if (state.state === 'gate' && state.step === 'denied' && fresh) await recordDenied(p.link, fresh);
    const res = sJson(state);
    if (setCookie) {
      res.cookies.set(sessionCookie(p.link.id), setCookie, { httpOnly: true, sameSite: 'lax', secure: Boolean(process.env.VERCEL) || req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https', path: '/', maxAge: SESSION_MAX_AGE });
    }
    return res;
  } catch (err) {
    return sFail(err);
  }
}
