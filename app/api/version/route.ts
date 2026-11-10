import { NextResponse } from 'next/server';
import { serverBuildId } from '@/lib/app-version';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Qué versión sirve el servidor ahora; la pestaña la compara con la suya (AppUpdateBanner). */
export async function GET() {
  return NextResponse.json({ build: serverBuildId() }, { headers: { 'cache-control': 'no-store' } });
}
