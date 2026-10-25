import { NextResponse } from 'next/server';
import { getAvailability, setAvailability } from '@/lib/groups-inbox';
import { groupsSession, handleGroupsError, readJson } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Quién está disponible para recibir chats (sin dato = disponible). */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const all = await getAvailability(s.ws);
  return NextResponse.json({ me: all[s.me] !== false, people: all });
}

/** Cada persona marca su estado: { available }. La asignación automática solo elige disponibles. */
export async function PUT(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    await setAvailability(s.ws, s.me, b.available !== false);
    return NextResponse.json({ me: b.available !== false });
  } catch (err) {
    return handleGroupsError(err);
  }
}
