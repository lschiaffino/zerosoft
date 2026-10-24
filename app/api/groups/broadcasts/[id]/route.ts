import { NextResponse } from 'next/server';
import { cancelBroadcast, deleteBroadcast, getBroadcast, updateBroadcast } from '@/lib/groups-broadcasts';
import { groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** El envío con el estado de cada destinatario. */
export async function GET(_req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const res = await getBroadcast(s.ws, (await ctx.params).id);
  return res ? NextResponse.json(res) : groupsError(404, 'not_found');
}

/** Editar mientras está programado, o { action: 'cancel' }. */
export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const b = await readJson(req);
  try {
    if (b.action === 'cancel') return NextResponse.json(await cancelBroadcast(s.ws, id));
    return NextResponse.json(
      await updateBroadcast(s.ws, id, {
        name: str(b.name, 120),
        body: str(b.body),
        scheduledAt: str(b.scheduledAt, 40),
        perMinute: b.perMinute === undefined ? undefined : Number(b.perMinute),
      }),
    );
  } catch (err) {
    return handleGroupsError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  return (await deleteBroadcast(s.ws, (await ctx.params).id)) ? NextResponse.json({ ok: true }) : groupsError(409, 'not_deletable');
}
