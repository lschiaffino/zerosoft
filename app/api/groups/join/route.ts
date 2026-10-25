import { NextResponse } from 'next/server';
import { joinGroup } from '@/lib/groups-org';
import { groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** { numberId, invite }: entra al grupo con el link o código de invitación y lo trae a Groups. */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const numberId = str(b.numberId, 100) ?? '';
  if (!numberId) return groupsError(400, 'invalid_number');
  try {
    return NextResponse.json(await joinGroup(s.ws, numberId, str(b.invite, 300) ?? ''), { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
