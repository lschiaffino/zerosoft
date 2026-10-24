import { NextResponse } from 'next/server';
import { createLabel, listLabels } from '@/lib/groups';
import { groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ labels: await listLabels(s.ws) });
}

export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    return NextResponse.json(await createLabel(s.ws, { name: str(b.name, 40), color: str(b.color, 20) }), { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
