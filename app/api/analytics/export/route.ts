import { NextRequest, NextResponse } from 'next/server';
import { actorProject, aError, analyticsActor, isResponse } from '@/lib/analytics/http';
import { csvLines } from '@/lib/analytics/compute-more';
import { liveEvents } from '@/lib/analytics/query';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE = 500;
const MAX_ROWS = 20_000;

/** Eventos en CSV (hasta 20.000, los más nuevos primero), con los filtros de la lista. */
export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const sp = req.nextUrl.searchParams;
  const project = await actorProject(actor, sp.get('project'));
  if (isResponse(project)) return project;
  const limit = await rateLimit(`aexport:${actor.workspaceId}`, 10, 60);
  if (!limit.ok && process.env.RATE_LIMIT_DISABLED !== 'true') return aError(429, 'rate_limited');
  const rows: unknown[][] = [['time', 'event', 'distinct_id', 'url', 'browser', 'os', 'device', 'country', 'properties']];
  let before: number | null = null;
  while (rows.length <= MAX_ROWS) {
    const page = await liveEvents(project, { before, event: sp.get('event'), distinctId: sp.get('distinct_id'), limit: PAGE });
    for (const e of page) rows.push([new Date(e.ts).toISOString(), e.event, e.distinctId, e.url, e.browser, e.os, e.device, e.country, JSON.stringify(e.properties)]);
    if (page.length < PAGE) break;
    before = page[page.length - 1].id;
  }
  return new NextResponse(csvLines(rows.slice(0, MAX_ROWS + 1)), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="events.csv"', 'cache-control': 'no-store' },
  });
}
