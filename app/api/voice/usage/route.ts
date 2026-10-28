import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth } from '@/lib/voice-route';
import { voiceJsonError } from '@/lib/voice-http';
import { isWorkspaceAdmin } from '@/lib/session';
import { teamUsage } from '@/lib/voice-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Uso de Voice del equipo (solo admins): dictados, palabras, minutos y
 * reuniones por persona en los últimos ?days= días (7, 30 o 90). Solo
 * números: nunca el texto de dictados ni reuniones.
 */
export async function GET(req: NextRequest) {
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  if (!isWorkspaceAdmin(auth.user)) return voiceJsonError(403, 'forbidden');
  const raw = Number(new URL(req.url).searchParams.get('days'));
  const days = [7, 30, 90].includes(raw) ? raw : 30;
  return NextResponse.json({ days, people: await teamUsage(auth.owner.workspaceId, days) });
}
