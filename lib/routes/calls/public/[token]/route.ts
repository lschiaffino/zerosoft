import { NextRequest } from 'next/server';
import { getSharedCall } from '@/lib/calls/core';
import { callsLimit, cJson } from '@/lib/calls/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: lo que muestra el link compartido (grabación, transcripción, resumen y próximos pasos). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const limited = await callsLimit(req, 'public', 120, 60);
  if (limited) return limited;
  const { token } = await ctx.params;
  const shared = await getSharedCall(token);
  if (!shared) return cJson({ error: 'not_found' }, 404);
  return cJson({ call: shared.view });
}
