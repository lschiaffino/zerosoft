import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { analyticsFilterOptions, cachedLinesAnalytics } from '@/lib/groups-analytics';
import { ANALYTICS_PERIODS, ANALYTICS_TZ_COOKIE, analyticsCsvRows, analyticsTab, isDay, toCsv, validTz } from '@/lib/groups-analytics-shared';
import { groupsSession, sessionViewer } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CSV de una pestaña de los reportes de Lines (?tab=, con los mismos filtros
 * que la página). Usa la misma caché corta: bajar lo que se está mirando no
 * vuelve a leer la base.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const p = new URL(req.url).searchParams;
  const viewer = await sessionViewer(s);
  const options = await analyticsFilterOptions(s.ws, viewer);
  const tab = analyticsTab(p.get('tab'));
  const from = isDay(p.get('from')) ? (p.get('from') as string) : undefined;
  const to = isDay(p.get('to')) ? (p.get('to') as string) : undefined;
  const inverted = Boolean(from && to && to < from);
  let tz: string | undefined;
  try {
    tz = decodeURIComponent((await cookies()).get(ANALYTICS_TZ_COOKIE)?.value ?? '');
  } catch {
    tz = undefined;
  }
  // Solo ids que la persona puede elegir, como en la página.
  const pick = (key: string, list: Array<{ id: string }>) => (list.some((x) => x.id === p.get(key)) ? (p.get(key) as string) : undefined);
  const data = await cachedLinesAnalytics(
    s.ws,
    viewer,
    tab,
    {
      days: (ANALYTICS_PERIODS as readonly number[]).includes(Number(p.get('days'))) ? Number(p.get('days')) : 30,
      from: inverted ? undefined : from,
      to: inverted ? undefined : to,
      tz: validTz(tz),
      numberId: pick('number', options.numbers),
      labelId: pick('label', options.labels),
      agentId: pick('agent', options.people),
    },
    options,
  );
  return new NextResponse(toCsv(analyticsCsvRows(data)), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="lines-${tab}-${data.range.from}-${data.range.to}.csv"`,
      'cache-control': 'private, no-store',
    },
  });
}
