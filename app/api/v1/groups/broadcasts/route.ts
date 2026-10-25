import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { createBroadcast, listBroadcasts } from '@/lib/groups-broadcasts';
import { visibleChatIds } from '@/lib/groups-access';
import { mediaFromBody } from '@/lib/groups-media-input';
import { v1Error, v1Json, v1Viewer } from '@/lib/groups-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/groups/broadcasts: envíos masivos y programados con su progreso. */
export async function GET(req: Request) {
  const auth = await requireApiUser(req, 'groups:read');
  if ('res' in auth) return auth.res;
  return NextResponse.json({ data: await listBroadcasts(auth.user.id) });
}

/**
 * POST /api/v1/groups/broadcasts
 * { chatIds, body | poll, media?, scheduledAt?, perMinute?, name?, numberId? }. El cron lo manda con el ritmo pedido.
 */
export async function POST(req: Request) {
  const auth = await requireApiUser(req, 'groups:write');
  if ('res' in auth) return auth.res;
  const b = await v1Json(req);
  const visible = await visibleChatIds(await v1Viewer(auth));
  const ids = Array.isArray(b.chatIds) ? b.chatIds.filter((x): x is string => typeof x === 'string').slice(0, 2000) : [];
  try {
    const res = await createBroadcast(auth.user.id, auth.personId, {
      numberId: typeof b.numberId === 'string' ? b.numberId : undefined,
      name: typeof b.name === 'string' ? b.name : undefined,
      body: typeof b.body === 'string' ? b.body : '',
      media: mediaFromBody(b.media, req),
      poll: b.poll ?? null,
      chatIds: ids.filter((id) => !visible || visible.has(id)),
      scheduledAt: typeof b.scheduledAt === 'string' ? b.scheduledAt : null,
      perMinute: Number(b.perMinute) || undefined,
      kind: ids.length === 1 && typeof b.scheduledAt === 'string' ? 'scheduled' : 'broadcast',
    });
    return NextResponse.json({ data: res }, { status: 201 });
  } catch (err) {
    return v1Error(err);
  }
}
