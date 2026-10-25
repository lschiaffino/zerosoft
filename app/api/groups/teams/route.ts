import { NextResponse } from 'next/server';
import { createTeam, listTeams } from '@/lib/groups-inbox';
import { groupsSession, handleGroupsError, readJson } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Equipos de la bandeja (para asignar chats y rotar en las reglas). */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ teams: await listTeams(s.ws) });
}

/** Crea un equipo: { name, memberIds }. Solo admins. */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    return NextResponse.json(await createTeam(s.ws, { name: b.name, memberIds: b.memberIds }), { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
