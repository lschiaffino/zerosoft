import { NextRequest, NextResponse } from 'next/server';
import { listCalls } from '@/lib/calls/core';
import { libraryCsv } from '@/lib/calls/export';
import { callsActor, contentDisposition } from '@/lib/calls/http';
import { sessionScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: la biblioteca filtrada (mismos filtros que /api/calls/calls) en CSV. */
export async function GET(req: NextRequest) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  const sp = req.nextUrl.searchParams;
  const num = (v: string | null) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const items = await listCalls(
    a.actor,
    { q: sp.get('q') ?? '', owner: sp.get('owner') ?? undefined, deal: sp.get('deal') ?? undefined, from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined, minMinutes: num(sp.get('minMinutes')), maxMinutes: num(sp.get('maxMinutes')), limit: 500 },
    await sessionScope(a.user),
  );
  return new NextResponse(libraryCsv(items), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': contentDisposition('attachment', 'calls.csv'), 'cache-control': 'private, no-store' },
  });
}
