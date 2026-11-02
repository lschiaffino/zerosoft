import { NextRequest } from 'next/server';
import { z } from 'zod';
import { checkNda, startNda } from '@/lib/send/nda';
import { loadSession, viewerState } from '@/lib/send/viewer';
import { parseBody, publicLink, sendLimit, sFail, sJson, type PublicCtx } from '@/lib/send/http';
import { nextGate } from '@/lib/send/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ action: z.enum(['start', 'check']), name: z.string().trim().max(120).optional(), locale: z.enum(['en', 'es', 'pt']).optional() });

/** POST: arma el sobre del acuerdo de esta persona, o mira si ya lo firmó. */
export async function POST(req: NextRequest, ctx: PublicCtx) {
  const p = await publicLink(req, (await ctx.params).token);
  if ('res' in p) return p.res;
  const limited = await sendLimit(req, 'nda', 60, 60);
  if (limited) return limited;
  try {
    const input = await parseBody(req, schema);
    const session = await loadSession(p.link, p.cookie);
    if (!session || nextGate(p.link, session) !== 'nda') return sJson({ error: 'not_on_this_step' }, 409);
    if (input.action === 'start') {
      if (!input.name) return sJson({ error: 'invalid_input' }, 400);
      const created = await sendLimit(req, 'nda-start', 5, 3600, p.link.id);
      if (created) return created;
      const { signPath } = await startNda(p.link, session, input.name, input.locale ?? 'en');
      return sJson({ signUrl: signPath });
    }
    if (await checkNda(session)) return sJson(await viewerState(p.link, await loadSession(p.link, p.cookie)));
    return sJson({ signed: false });
  } catch (err) {
    return sFail(err);
  }
}
