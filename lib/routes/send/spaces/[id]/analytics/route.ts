import { NextRequest, NextResponse } from 'next/server';
import { getSpace, spaceAnalytics, spaceCsv } from '@/lib/send/spaces';
import { sendActor, sFail, sJson } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: números del espacio por documento y por persona. ?format=csv: solo admins. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const s = await getSpace(a.actor, (await ctx.params).id);
    const data = await spaceAnalytics(a.actor, s.id);
    if (req.nextUrl.searchParams.get('format') === 'csv') {
      if (!a.actor.admin) return sJson({ error: 'forbidden' }, 403);
      return new NextResponse(spaceCsv(data), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="send-space-visits.csv"', 'cache-control': 'private, no-store' } });
    }
    return sJson(data);
  } catch (err) {
    return sFail(err);
  }
}
