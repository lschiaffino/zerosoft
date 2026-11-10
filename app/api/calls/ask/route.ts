import { NextRequest } from 'next/server';
import { z } from 'zod';
import { askAllCalls } from '@/lib/calls/ask';
import { callsActor, callsLimit, cFail, cJson, parseBody } from '@/lib/calls/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ question: z.string().trim().min(2).max(1000), locale: z.enum(['en', 'es', 'pt']).optional() });

/** POST: pregunta sobre todas las llamadas que la persona ve; responde citando cuáles. */
export async function POST(req: NextRequest) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  const limited = await callsLimit(req, 'ask', 60, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const input = await parseBody(req, schema);
    return cJson(await askAllCalls(a.actor, input.question, input.locale ?? 'en'));
  } catch (err) {
    return cFail(err);
  }
}
