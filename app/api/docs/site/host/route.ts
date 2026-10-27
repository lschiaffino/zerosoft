import { NextRequest, NextResponse } from 'next/server';
import { siteForHost } from '@/lib/docs-site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ¿Este host es el dominio propio verificado de un sitio de Docs? Lo pregunta
 * el middleware (que no tiene DB) para reescribir a /<locale>/h/<handle>.
 * Público: solo dice el handle del workspace, que ya es público en /h/<handle>.
 */
export async function GET(req: NextRequest) {
  const host = (req.nextUrl.searchParams.get('host') ?? '').slice(0, 253);
  const site = host ? await siteForHost(host) : null;
  const headers = { 'cache-control': 'public, max-age=30, s-maxage=60' };
  if (!site) return NextResponse.json({ site: null }, { status: 404, headers });
  return NextResponse.json({ site: { handle: site.handle, locale: site.locale } }, { headers });
}
