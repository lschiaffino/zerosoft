import { NextRequest } from 'next/server';
import { canEditCall, getCallRow } from '@/lib/calls/core';
import { reanalyze } from '@/lib/calls/process';
import { callsActor, callsLimit, cFail, cJson } from '@/lib/calls/http';
import { CallsError } from '@/lib/calls/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST: vuelve a pedir el análisis con la metodología y los competidores de hoy. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  const limited = await callsLimit(req, 'reanalyze', 30, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const { id } = await ctx.params;
    const row = await getCallRow(a.actor, id);
    if (!canEditCall(a.actor, row)) throw new CallsError('forbidden', 403);
    if (row.status !== 'ready') throw new CallsError('not_ready', 409);
    return cJson({ analysis: await reanalyze(row) });
  } catch (err) {
    return cFail(err);
  }
}
