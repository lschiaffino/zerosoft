import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { deleteNotification, markNotificationRead, snoozeNotification } from '@/lib/notifications';
import { trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  if (body && typeof body === 'object' && 'read' in body && body.read === true) {
    await markNotificationRead(params.id, realUserId(user));
  }
  // Posponer: { snoozeUntil: ISO } lo esconde hasta esa fecha; null lo trae de vuelta.
  if (body && typeof body === 'object' && 'snoozeUntil' in body) {
    const until = (body as { snoozeUntil: unknown }).snoozeUntil;
    if (until !== null && typeof until !== 'string') return trackError(400, 'invalid_date');
    const ok = await snoozeNotification(params.id, realUserId(user), until);
    if (!ok) return trackError(400, 'invalid_date');
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  await deleteNotification(params.id, realUserId(user));
  return NextResponse.json({ ok: true });
}
