import { NextResponse } from 'next/server';
import { createRule, listRules } from '@/lib/groups-inbox';
import { groupsSession, handleGroupsError, readJson } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reglas de asignación automática round-robin. */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ rules: await listRules(s.ws) });
}

/**
 * Crea una regla: { name, numberId?, labelId?, kind?, teamId? | personIds }.
 * Solo admins. Al crearla reparte los chats que ya esperaban sin asignar.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    return NextResponse.json(await createRule(s.ws, b), { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
