import { after, NextResponse } from 'next/server';
import { canAccessBroadcast, cancelBroadcast, deleteBroadcast, getBroadcast, processBroadcasts, sendBroadcastNow, updateBroadcast } from '@/lib/groups-broadcasts';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str, type GroupsSession } from '@/lib/groups-http';
import { visibleChatIds } from '@/lib/groups-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** 404 si el envío no existe o va a algún chat que la persona no ve (acceso por etiqueta o por línea). */
async function broadcastGuard(s: GroupsSession, id: string): Promise<NextResponse | null> {
  const visible = await visibleChatIds(await sessionViewer(s));
  return (await canAccessBroadcast(s.ws, id, visible)) ? null : groupsError(404, 'not_found');
}

/** El envío con el estado de cada destinatario. */
export async function GET(_req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const denied = await broadcastGuard(s, id);
  if (denied) return denied;
  const res = await getBroadcast(s.ws, id);
  return res ? NextResponse.json(res) : groupsError(404, 'not_found');
}

/** Editar mientras está programado, { action: 'cancel' } o { action: 'send_now' } (sale ya). */
export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const denied = await broadcastGuard(s, id);
  if (denied) return denied;
  const b = await readJson(req);
  try {
    if (b.action === 'cancel') return NextResponse.json(await cancelBroadcast(s.ws, id));
    if (b.action === 'send_now') {
      const sent = await sendBroadcastNow(s.ws, id);
      after(() => processBroadcasts({ broadcastId: id, budgetMs: 25_000 }).catch(() => null));
      return NextResponse.json(sent);
    }
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
  const id = (await ctx.params).id;
  const denied = await broadcastGuard(s, id);
  if (denied) return denied;
  return (await deleteBroadcast(s.ws, id)) ? NextResponse.json({ ok: true }) : groupsError(409, 'not_deletable');
}
