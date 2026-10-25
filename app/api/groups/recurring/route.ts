import { NextResponse } from 'next/server';
import { createRecurring, listRecurring } from '@/lib/groups-recurring';
import { visibleChatIds } from '@/lib/groups-access';
import { groupsSession, handleGroupsError, readJson, sessionViewer, str, strArr } from '@/lib/groups-http';
import { mediaFromBody } from '@/lib/groups-media-input';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mensajes recurrentes del workspace (?chat=<id> para los de un chat). */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const chat = new URL(req.url).searchParams.get('chat') || undefined;
  const visible = await visibleChatIds(await sessionViewer(s));
  const list = await listRecurring(s.ws, { chatId: chat });
  return NextResponse.json({ recurring: visible ? list.filter((r) => r.chatIds.some((id) => visible.has(id))) : list });
}

/**
 * Crea una serie: { chatIds, body | poll, rule: { freq, time, days, dayOfMonth, cron },
 * timezone, endsAt?, perMinute?, name?, media?, numberId? }.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    const visible = await visibleChatIds(await sessionViewer(s));
    const chatIds = strArr(b.chatIds, 2000).filter((id) => !visible || visible.has(id));
    const rec = await createRecurring(s.ws, s.me, {
      numberId: str(b.numberId, 100),
      name: str(b.name, 120),
      body: str(b.body) ?? '',
      media: mediaFromBody(b.media, req),
      poll: b.poll ?? null,
      chatIds,
      rule: b.rule,
      timezone: str(b.timezone, 80),
      perMinute: Number(b.perMinute) || undefined,
      endsAt: str(b.endsAt, 40) || null,
    });
    return NextResponse.json(rec, { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
