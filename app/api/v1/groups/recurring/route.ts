import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { createRecurring, listRecurring } from '@/lib/groups-recurring';
import { visibleChatIds } from '@/lib/groups-access';
import { mediaFromBody } from '@/lib/groups-media-input';
import { v1Error, v1Json, v1Viewer } from '@/lib/groups-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/groups/recurring: mensajes recurrentes con su próxima corrida. */
export async function GET(req: Request) {
  const auth = await requireApiUser(req, 'groups:read');
  if ('res' in auth) return auth.res;
  const visible = await visibleChatIds(await v1Viewer(auth));
  const list = await listRecurring(auth.user.id);
  return NextResponse.json({ data: visible ? list.filter((r) => r.chatIds.some((id) => visible.has(id))) : list });
}

/** POST /api/v1/groups/recurring { chatIds, body | poll, rule, timezone?, endsAt?, perMinute?, name? } */
export async function POST(req: Request) {
  const auth = await requireApiUser(req, 'groups:write');
  if ('res' in auth) return auth.res;
  const b = await v1Json(req);
  const visible = await visibleChatIds(await v1Viewer(auth));
  const ids = Array.isArray(b.chatIds) ? b.chatIds.filter((x): x is string => typeof x === 'string').slice(0, 2000) : [];
  try {
    const rec = await createRecurring(auth.user.id, auth.personId, {
      numberId: typeof b.numberId === 'string' ? b.numberId : undefined,
      name: typeof b.name === 'string' ? b.name : undefined,
      body: typeof b.body === 'string' ? b.body : '',
      media: mediaFromBody(b.media, req),
      poll: b.poll ?? null,
      chatIds: ids.filter((id) => !visible || visible.has(id)),
      rule: b.rule,
      timezone: typeof b.timezone === 'string' ? b.timezone : undefined,
      perMinute: Number(b.perMinute) || undefined,
      endsAt: typeof b.endsAt === 'string' ? b.endsAt : null,
    });
    return NextResponse.json({ data: rec }, { status: 201 });
  } catch (err) {
    return v1Error(err);
  }
}
