import { NextRequest } from 'next/server';
import { getDocument } from '@/lib/send/core';
import { liveReaders } from '@/lib/send/analytics';
import { sendActor, sFail, sJson } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: quién está leyendo ahora. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    const d = await getDocument(a.actor, id);
    return sJson({ readers: await liveReaders(d.id) });
  } catch (err) {
    return sFail(err);
  }
}
