import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth } from '@/lib/voice-route';
import { listSharedWithMe } from '@/lib/voice-share';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reuniones que otras personas compartieron con el workspace o con esta persona (?q= filtra por título). */
export async function GET(req: NextRequest) {
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  const q = new URL(req.url).searchParams.get('q')?.slice(0, 200) ?? null;
  return NextResponse.json({ meetings: await listSharedWithMe(auth.owner, { q }) });
}
