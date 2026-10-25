import { NextResponse } from 'next/server';
import { createSavedList, listSavedLists } from '@/lib/groups-org';
import { groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Listas guardadas de chats: las compartidas y las propias (?counts=1 suma cuántos chats tiene cada una). */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const counts = new URL(req.url).searchParams.get('counts') === '1';
  return NextResponse.json({ lists: await listSavedLists(s.ws, s.me, { counts }) });
}

/** { name, shared, filters }. Una compartida la ve todo el equipo; la edita quien la creó o un admin. */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    return NextResponse.json(await createSavedList(s.ws, s.me, { name: str(b.name, 60), shared: b.shared === true, filters: b.filters }), { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
