import type { NextRequest } from 'next/server';
import { hiringActor, hiringLimit } from '@/lib/hiring/http';
import { applicationsCsv } from '@/lib/hiring/transfer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?status=&job=&source=&tag=&q=: CSV de las postulaciones que la persona ve. */
export async function GET(req: NextRequest) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  const limited = await hiringLimit(req, 'export', 20, 3600, a.actor.person);
  if (limited) return limited;
  const sp = req.nextUrl.searchParams;
  const csv = await applicationsCsv(a.actor, { status: sp.get('status') ?? 'all', jobId: sp.get('job') ?? undefined, source: sp.get('source') ?? undefined, tag: sp.get('tag') ?? undefined, q: sp.get('q') ?? undefined });
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="candidates.csv"', 'cache-control': 'no-store' } });
}
