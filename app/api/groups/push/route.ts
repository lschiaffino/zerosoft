import { NextResponse } from 'next/server';
import { countSubscriptions, deleteSubscription, saveSubscription, validEndpoint, vapidKeys } from '@/lib/groups-push';
import { groupsError, groupsSession, readJson } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Clave pública VAPID (null si el servidor no tiene push configurado) y cuántos navegadores tiene la persona. */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const keys = vapidKeys();
  return NextResponse.json({ publicKey: keys?.publicKey ?? null, devices: await countSubscriptions(s.ws, s.me) });
}

/** { subscription: PushSubscription.toJSON() } */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  if (!vapidKeys()) return groupsError(503, 'push_disabled');
  const b = await readJson(req);
  const sub = (b.subscription ?? {}) as { endpoint?: unknown; keys?: { p256dh?: string; auth?: string } };
  if (!validEndpoint(sub.endpoint)) return groupsError(400, 'invalid_subscription');
  await saveSubscription(s.ws, s.me, { endpoint: sub.endpoint, keys: sub.keys }, req.headers.get('user-agent') ?? '');
  return NextResponse.json({ ok: true, devices: await countSubscriptions(s.ws, s.me) }, { status: 201 });
}

/** { endpoint } */
export async function DELETE(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  if (typeof b.endpoint !== 'string') return groupsError(400, 'invalid_subscription');
  await deleteSubscription(s.me, b.endpoint);
  return NextResponse.json({ ok: true, devices: await countSubscriptions(s.ws, s.me) });
}
