import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { exportRuns, runSearchFromParams } from '@/lib/flow-monitor';
import { runViewer, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Exporta el historial filtrado (?format=csv|json más los filtros de /api/flow/runs). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const format = req.nextUrl.searchParams.get('format') === 'json' ? 'json' : 'csv';
  const body = await exportRuns(user.id, runViewer(user), runSearchFromParams(req.nextUrl.searchParams), format);
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      'content-type': format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="flow-runs-${day}.${format}"`,
      'cache-control': 'no-store',
    },
  });
}
