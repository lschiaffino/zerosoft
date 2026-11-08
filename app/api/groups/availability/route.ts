import { NextResponse } from 'next/server';
import { getAvailabilityStatus, setAvailability } from '@/lib/groups-inbox';
import { cleanAvailability } from '@/lib/groups-lines-shared';
import { groupsError, groupsSession, handleGroupsError, readJson, strArr } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Quién está disponible para recibir chats (sin dato = en línea).
 * `me` y `people` son true/false (en línea o no) por compatibilidad; `status` y `statuses` traen online, away u offline.
 */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const all = await getAvailabilityStatus(s.ws);
  return NextResponse.json({
    me: (all[s.me] ?? 'online') === 'online',
    status: all[s.me] ?? 'online',
    people: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v === 'online'])),
    statuses: all,
  });
}

/**
 * Cada persona marca su estado: { status: 'online' | 'away' | 'offline' } (o { available } por compatibilidad).
 * Un admin puede cambiar el de otros: { status, personIds }.
 * La asignación automática elige según la condición de cada regla.
 */
export async function PUT(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  if (b.status !== undefined && !cleanAvailability(b.status)) return groupsError(400, 'invalid_status');
  if (b.status === undefined && typeof b.available !== 'boolean') return groupsError(400, 'invalid_status');
  const status = cleanAvailability(b.status) ?? (b.available === false ? 'away' : 'online');
  const others = strArr(b.personIds, 200).filter((id) => id !== s.me);
  if (others.length && !s.isAdmin) return groupsError(403, 'forbidden');
  try {
    if (others.length) {
      const { listPeople } = await import('@/lib/groups');
      const people = new Set((await listPeople(s.ws)).map((p) => p.id));
      for (const id of others) if (people.has(id)) await setAvailability(s.ws, id, status, s.me);
      if (!strArr(b.personIds, 200).includes(s.me)) return NextResponse.json({ status, personIds: others });
    }
    const mine = await setAvailability(s.ws, s.me, status, s.me);
    return NextResponse.json({ me: mine === 'online', status: mine });
  } catch (err) {
    return handleGroupsError(err);
  }
}
