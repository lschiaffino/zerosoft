import { NextResponse } from 'next/server';
import { updateFeed } from '@/lib/desktop-release';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Feed de electron-updater para Mac (lib/desktop-release.ts). */
export async function GET() {
  const yml = await updateFeed('latest-mac.yml');
  if (!yml) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(yml, { headers: { 'content-type': 'text/yaml; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
