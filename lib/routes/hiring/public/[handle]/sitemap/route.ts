import { NextRequest, NextResponse } from 'next/server';
import { careersSitemap } from '@/lib/hiring/careers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ handle: string }> };

/** sitemap.xml de la página de empleos (next.config reescribe /careers/<handle>/sitemap.xml acá). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const xml = await careersSitemap((await params).handle);
  if (!xml) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600' } });
}
