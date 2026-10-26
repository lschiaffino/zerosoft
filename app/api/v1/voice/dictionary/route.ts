import { NextRequest, NextResponse } from 'next/server';
import { voiceApiAuth } from '@/lib/voice-v1';
import { getVoiceSettings, listDictionary } from '@/lib/voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/voice/dictionary (voice:read): diccionario y ajustes de dictado (la app de escritorio los sincroniza). */
export async function GET(req: NextRequest) {
  const auth = await voiceApiAuth(req, 'voice:read');
  if (auth.res) return auth.res;
  const [entries, settings] = await Promise.all([listDictionary(auth.owner), getVoiceSettings(auth.owner)]);
  return NextResponse.json({ data: { entries, settings } });
}
