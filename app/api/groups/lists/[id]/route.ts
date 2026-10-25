import { NextResponse } from 'next/server';
import { deleteSavedList, getSavedList, savedListChatIds, updateSavedList } from '@/lib/groups-org';
import { groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** La lista; con ?chats=1 también los chats que entran hoy (audiencia de un envío masivo). */
export async function GET(req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const list = await getSavedList(s.ws, s.me, id);
  if (!list) return groupsError(404, 'not_found');
  if (new URL(req.url).searchParams.get('chats') === '1') return NextResponse.json({ list, chats: await savedListChatIds(s.ws, s.me, id) });
  return NextResponse.json({ list });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    return NextResponse.json(
      await updateSavedList(
        s.ws,
        s.me,
        (await ctx.params).id,
        { name: str(b.name, 60), shared: typeof b.shared === 'boolean' ? b.shared : undefined, filters: b.filters },
        s.isAdmin,
      ),
    );
  } catch (err) {
    return handleGroupsError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  try {
    return (await deleteSavedList(s.ws, s.me, (await ctx.params).id, s.isAdmin)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
  } catch (err) {
    return handleGroupsError(err);
  }
}
