import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  type NotificationType,
} from '@/lib/notifications';
import { unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const unreadOnly = sp.get('unreadOnly') === '1';
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? '20') || 20, 1), 100);
  const page = Math.max(Number(sp.get('page') ?? '1') || 1, 1);
  const types = sp.getAll('type').filter(Boolean);
  const snoozed = sp.get('snoozed') === '1';

  const [rows, unreadCount] = await Promise.all([
    listNotifications(realUserId(user), {
      unreadOnly,
      limit,
      page,
      type: types.length ? (types as NotificationType[]) : undefined,
      snoozed,
    }),
    countUnreadNotifications(realUserId(user)),
  ]);

  return NextResponse.json({ rows, unreadCount });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  if (body && typeof body === 'object' && 'readAll' in body && body.readAll === true) {
    await markAllNotificationsRead(realUserId(user));
  }

  const unreadCount = await countUnreadNotifications(realUserId(user));
  return NextResponse.json({ ok: true, unreadCount });
}
