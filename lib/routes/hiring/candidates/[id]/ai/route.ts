import { NextRequest } from 'next/server';
import { z } from 'zod';
import { parseResume, summarizeCandidate } from '@/lib/hiring/ai';
import { hFail, hiringActor, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { action: parse | summary }: la IA completa campos del resume o resume al candidato. Nunca decide. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    const { action, locale } = await parseBody(req, z.object({ action: z.enum(['parse', 'summary']), locale: z.enum(['en', 'es', 'pt']).default('en') }));
    const id = (await params).id;
    return hJson({ candidate: action === 'parse' ? await parseResume(a.actor, id) : await summarizeCandidate(a.actor, id, locale) });
  } catch (err) {
    return hFail(err);
  }
}
