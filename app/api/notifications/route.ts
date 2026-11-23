import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { appFromPath, userCanUseApp } from '@/lib/workspace';
import { PRODUCT_CONFIG, type ProductKey } from '@/lib/products';
import { markAllNotificationsRead, type NotificationType } from '@/lib/notifications';
import { countVisibleUnread, listVisibleNotifications } from '@/lib/notification-access';
import { unauthorized } from '@/lib/track-http';
import { noStore } from '@/lib/no-store';
import { nextSnoozeWake, notificationKey, notificationRev, notificationTag, notificationTagFresh } from '@/lib/notification-rev';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Paths de las apps que la persona no tiene en el workspace activo: sus avisos no cuentan como sin leer. */
function hiddenAppPaths(user: Parameters<typeof userCanUseApp>[0] & { actingUser?: unknown }): string[] {
  if (!user.actingUser) return [];
  return (Object.keys(PRODUCT_CONFIG) as ProductKey[]).filter((k) => !userCanUseApp(user, k)).map((k) => PRODUCT_CONFIG[k].launch);
}

async function getPrivate(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const unreadOnly = sp.get('unreadOnly') === '1';
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? '20') || 20, 1), 100);
  const page = Math.max(Number(sp.get('page') ?? '1') || 1, 1);
  const types = sp.getAll('type').filter(Boolean);
  const snoozed = sp.get('snoozed') === '1';

  // Nada cambió desde la última respuesta (lib/notification-rev.ts): 304 leyendo una fila.
  const uid = realUserId(user);
  const hide = hiddenAppPaths(user);
  const key = notificationKey(uid, req.nextUrl.search, hide);
  const rev = await notificationRev(uid);
  const sent = req.headers.get('if-none-match');
  if (notificationTagFresh(sent, rev, key)) return new NextResponse(null, { status: 304, headers: { etag: sent! } });

  // Acceso por app: en un workspace ajeno no se muestran avisos de apps que la persona no tiene.
  const keep = user.actingUser
    ? (n: { href: string | null }) => {
        const app = appFromPath(n.href);
        return !app || userCanUseApp(user, app);
      }
    : undefined;
  // Y nunca avisos de algo que hoy no puede ver (lib/notification-access).
  const [rows, unreadCount, wakeAt] = await Promise.all([
    listVisibleNotifications(
      uid,
      { unreadOnly, limit, page, type: types.length ? (types as NotificationType[]) : undefined, snoozed },
      keep,
    ),
    countVisibleUnread(uid, { hidePaths: hide }),
    nextSnoozeWake(uid),
  ]);
  return NextResponse.json({ rows, unreadCount }, { headers: { etag: notificationTag(rev, wakeAt, key) } });
}

async function patchPrivate(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  if (body && typeof body === 'object' && 'readAll' in body && body.readAll === true) {
    await markAllNotificationsRead(realUserId(user));
  }

  const unreadCount = await countVisibleUnread(realUserId(user), { hidePaths: hiddenAppPaths(user) });
  return NextResponse.json({ ok: true, unreadCount });
}

/** Datos de la persona: sin caché (lib/no-store.ts). */
export async function GET(...args: Parameters<typeof getPrivate>) {
  return noStore(await getPrivate(...args));
}

/** Datos de la persona: sin caché (lib/no-store.ts). */
export async function PATCH(...args: Parameters<typeof patchPrivate>) {
  return noStore(await patchPrivate(...args));
}
