import { NextRequest } from 'next/server';
import { z } from 'zod';
import { loadSession, recordDenied, sendEmailCode, verifyEmailCode, viewerState } from '@/lib/send/viewer';
import { sendLocale } from '@/lib/send/i18n';
import { parseBody, publicLink, sendLimit, sFail, sJson, type PublicCtx } from '@/lib/send/http';
import { nextGate } from '@/lib/send/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ action: z.enum(['send', 'verify']), code: z.string().max(12).optional(), locale: z.string().max(5).optional() });

/** POST: manda el código al email escrito, o lo comprueba. */
export async function POST(req: NextRequest, ctx: PublicCtx) {
  const p = await publicLink(req, (await ctx.params).token);
  if ('res' in p) return p.res;
  const limited = await sendLimit(req, 'code', 30, 60);
  if (limited) return limited;
  try {
    const input = await parseBody(req, schema);
    const session = await loadSession(p.link, p.cookie);
    if (!session || nextGate(p.link, session) !== 'verify') return sJson({ error: 'not_on_this_step' }, 409);
    if (input.action === 'send') {
      await sendEmailCode(p.link, session, sendLocale(input.locale), p.ip);
      return sJson({ sent: true });
    }
    await verifyEmailCode(p.link, session, input.code ?? '');
    const fresh = await loadSession(p.link, p.cookie);
    const state = await viewerState(p.link, fresh);
    if (state.state === 'gate' && state.step === 'denied' && fresh) await recordDenied(p.link, fresh);
    return sJson(state);
  } catch (err) {
    return sFail(err);
  }
}
