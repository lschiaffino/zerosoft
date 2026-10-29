import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { desktopBadge } from '@/lib/desktop-badge';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Contador del dock y avisos nuevos para la app de escritorio (la consulta
 * cada 30 s con su sesión). ?since=<ISO de la respuesta anterior>.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const since = req.nextUrl.searchParams.get('since')?.slice(0, 40) ?? null;
  return NextResponse.json(await desktopBadge(user, since), { headers: { 'cache-control': 'no-store' } });
}
