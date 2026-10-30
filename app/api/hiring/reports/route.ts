import { NextRequest } from 'next/server';
import { hiringReport } from '@/lib/hiring/reports';
import { hiringActor, hJson } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?days=&jobId=: reportes sobre las postulaciones que la persona ve. */
export async function GET(req: NextRequest) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  const sp = req.nextUrl.searchParams;
  return hJson({ report: await hiringReport(a.actor, { days: Number(sp.get('days') ?? 90), jobId: sp.get('jobId') || null }) });
}
