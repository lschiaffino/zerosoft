import { NextRequest } from 'next/server';
import { getDocument } from '@/lib/send/core';
import { documentAnalytics } from '@/lib/send/analytics';
import { sendActor, sFail, sJson } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?version=&link=: números del documento, de una versión o de un link. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    const d = await getDocument(a.actor, id);
    const sp = req.nextUrl.searchParams;
    return sJson(await documentAnalytics(d.id, { versionId: sp.get('version') ?? undefined, linkId: sp.get('link') ?? undefined }));
  } catch (err) {
    return sFail(err);
  }
}
