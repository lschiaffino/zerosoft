import { NextResponse } from 'next/server';
import { notifyPerson, vapidKeys } from '@/lib/groups-push';
import { groupsError, groupsSession, readJson } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Aviso de prueba a los navegadores de la persona. { title, body } en su idioma. */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  if (!vapidKeys()) return groupsError(503, 'push_disabled');
  const b = await readJson(req);
  const sent = await notifyPerson(s.ws, s.me, {
    chatId: null,
    title: typeof b.title === 'string' ? b.title.slice(0, 120) : 'Groups',
    body: typeof b.body === 'string' ? b.body.slice(0, 240) : '',
  });
  if (sent === 0) return groupsError(409, 'no_devices');
  return NextResponse.json({ ok: true, sent });
}
