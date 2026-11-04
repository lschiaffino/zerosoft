import { NextResponse } from 'next/server';
import { clearSampleData, loadSampleData } from '@/lib/groups-sample';
import { groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Carga los datos de ejemplo (admins). Si ya estaban, devuelve el mismo número. */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  try {
    return NextResponse.json(await loadSampleData(s.ws, s.me, str(body.locale, 5) ?? 'es'), { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** Borra todos los datos de ejemplo de una vez (los reales no se tocan). */
export async function DELETE() {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  try {
    return NextResponse.json({ ok: true, removed: await clearSampleData(s.ws) });
  } catch (err) {
    return handleGroupsError(err);
  }
}
