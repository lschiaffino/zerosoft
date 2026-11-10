import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getCallRow } from '@/lib/calls/core';
import { askCall } from '@/lib/calls/ai';
import { callsActor, callsLimit, cFail, cJson, parseBody } from '@/lib/calls/http';
import { parseJson, type Speaker, type Utterance } from '@/lib/calls/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ question: z.string().trim().min(2).max(1000), locale: z.enum(['en', 'es', 'pt']).optional() });

/** POST: pregunta sobre esta llamada; la respuesta cita los momentos [m:ss]. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  const limited = await callsLimit(req, 'ask', 60, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const { id } = await ctx.params;
    const input = await parseBody(req, schema);
    const row = await getCallRow(a.actor, id);
    const answer = await askCall({
      ws: a.actor.ws,
      title: row.title,
      utterances: parseJson<Utterance[]>(row.transcript, []),
      speakers: parseJson<Speaker[]>(row.speakers, []),
      question: input.question,
      locale: input.locale ?? 'en',
    });
    return cJson({ answer });
  } catch (err) {
    return cFail(err);
  }
}
