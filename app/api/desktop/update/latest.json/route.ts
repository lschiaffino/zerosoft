import { NextResponse } from 'next/server';
import { updateFeed } from '@/lib/desktop-release';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Feed del updater de Tauri (Mac y Windows): el latest.json del último release desktop-v*. */
export async function GET() {
  const json = await updateFeed('latest.json');
  if (!json) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(json, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
