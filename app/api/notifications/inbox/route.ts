import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { appFromPath, userCanUseApp } from '@/lib/workspace';
import { unauthorized } from '@/lib/track-http';
import { noStore } from '@/lib/no-store';
import { listInboxNotifications } from '@/lib/notification-inbox';
import { parseInboxFilter } from '@/lib/notification-inbox-filter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bandeja de Track con filtros: ?read=unread|read, kind, project, team, from
 * (varios), order=newest|oldest, group=none|kind|project|team, la pestaña
 * (type varios, snoozed=1) y la página. Devuelve las filas, si hay más y las
 * opciones de cada filtro con su cantidad.
 */
async function getPrivate(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const result = await listInboxNotifications(realUserId(user), {
    filter: parseInboxFilter(sp),
    types: sp.getAll('type').filter(Boolean).slice(0, 20),
    snoozed: sp.get('snoozed') === '1',
    page: Number(sp.get('page') ?? '1') || 1,
    limit: Number(sp.get('limit') ?? '25') || 25,
    // En un workspace ajeno no se muestran avisos de apps que la persona no tiene.
    visible: user.actingUser
      ? (n) => {
          const app = appFromPath(n.href);
          return !app || userCanUseApp(user, app);
        }
      : undefined,
  });
  return NextResponse.json(result);
}

/** Datos de la persona: sin caché (lib/no-store.ts). */
export async function GET(...args: Parameters<typeof getPrivate>) {
  return noStore(await getPrivate(...args));
}
