import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { requestLocale } from '@/lib/request-locale';
import { computeDashboardTiles } from '@/lib/crm-dashboards';
import { dashboardTilesRequestSchema } from '@/lib/crm-dashboards-schema';
import { dashboardErrorResponse, sessionTileViewer } from '@/lib/crm-dashboards-session';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Datos de los tiles de un dashboard con los filtros dados, calculados con
 * la persona que mira (su alcance y sus campos ocultos).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dashboardTilesRequestSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const locale = requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
  try {
    const tiles = await computeDashboardTiles(
      await sessionTileViewer(user, locale),
      parsed.data.dashboardId,
      parsed.data.filters,
      parsed.data.widgetIds,
    );
    return NextResponse.json({ tiles });
  } catch (e) {
    return dashboardErrorResponse(e);
  }
}
