import { NextRequest, NextResponse } from 'next/server';
import { getDocument } from '@/lib/send/core';
import { analyticsCsv, documentAnalytics } from '@/lib/send/analytics';
import { sendActor, sFail, sJson } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: CSV con cada visita y sus segundos por página. Solo admins. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  if (!a.actor.admin) return sJson({ error: 'forbidden' }, 403);
  try {
    const { id } = await ctx.params;
    const d = await getDocument(a.actor, id);
    const csv = analyticsCsv(await documentAnalytics(d.id));
    return new NextResponse(csv, {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="send-visits.csv"', 'cache-control': 'private, no-store' },
    });
  } catch (err) {
    return sFail(err);
  }
}
