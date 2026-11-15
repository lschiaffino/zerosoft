import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrency, setCurrency } from '@/lib/time/core';
import { parseBody, tFail, timeActor, tJson } from '@/lib/time/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const a = await timeActor();
  if ('res' in a) return a.res;
  return tJson({ currency: await getCurrency(a.actor.ws) });
}

/** PATCH { currency }: moneda de las tarifas del workspace (solo quien administra). */
export async function PATCH(req: NextRequest) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  try {
    const { currency } = await parseBody(req, z.object({ currency: z.string().max(3) }));
    await setCurrency(a.actor, currency);
    return tJson({ currency });
  } catch (err) {
    return tFail(err);
  }
}
