import { NextResponse } from 'next/server';
import { translateText } from '@/lib/groups-ai';
import { groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Traduce la respuesta antes de mandarla: { text, to }. Vuelve al composer para revisarla. */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    return NextResponse.json(await translateText(s.ws, str(b.text, 4000) ?? '', str(b.to, 10) ?? ''));
  } catch (err) {
    return handleGroupsError(err);
  }
}
