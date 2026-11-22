import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { requestLocale } from '@/lib/request-locale';
import { drillTile } from '@/lib/crm-dashboards';
import { dashboardDrillRequestSchema } from '@/lib/crm-dashboards-schema';
import { dashboardErrorResponse, sessionTileViewer } from '@/lib/crm-dashboards-session';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Registros detrás de un número, barra o segmento de un tile (solo los que la persona ve). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dashboardDrillRequestSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const locale = requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
  try {
    const { dashboardId, widgetId, filters, segment } = parsed.data;
    return NextResponse.json(await drillTile(await sessionTileViewer(user, locale), dashboardId, widgetId, filters, segment));
  } catch (e) {
    return dashboardErrorResponse(e);
  }
}
