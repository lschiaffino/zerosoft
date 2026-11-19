import { NextResponse } from 'next/server';
import { getPresence, setPresence } from '@/lib/groups-inbox';
import { cleanPresence } from '@/lib/groups-inbox-rules';
import { groupsSession, handleGroupsError, readJson } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Estado de cada persona para recibir chats: online, away u offline (sin dato = online). */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const all = await getPresence(s.ws);
  return NextResponse.json({ me: all[s.me] ?? 'online', people: all });
}

/**
 * Cada persona marca su estado: { status: 'online' | 'away' | 'offline' }
 * (o el viejo { available }: true = online, false = offline). La asignación
 * automática solo elige a quien está online; pasar a offline puede repartir
 * los chats abiertos si la regla lo pide.
 */
export async function PUT(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const status = b.status !== undefined ? cleanPresence(b.status) : b.available === false ? 'offline' : 'online';
  if (!status) return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  try {
    const r = await setPresence(s.ws, s.me, status);
    return NextResponse.json({ me: r.status, reassigned: r.reassigned });
  } catch (err) {
    return handleGroupsError(err);
  }
}
