import { NextResponse } from 'next/server';
import { getSettings, updateSettings } from '@/lib/groups';
import { groupsSession, readJson } from '@/lib/groups-http';
import type { GroupsSettings } from '@/lib/groups-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reglas de tickets, SLA y umbral de "sin responder". */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json(await getSettings(s.ws));
}

export async function PATCH(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = (await readJson(req)) as Partial<GroupsSettings>;
  return NextResponse.json(await updateSettings(s.ws, b));
}
