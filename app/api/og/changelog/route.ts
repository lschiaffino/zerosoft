import { NextResponse } from 'next/server';
import { CHANGELOG } from '@/content/changelog';
import { generateProductOGSVG } from '@/lib/product-og';

export const dynamic = 'force-static';

// Imagen OG del changelog: mismo lenguaje que las de producto, con la última fecha.
export async function GET() {
  const latest = CHANGELOG[0]?.date ?? '';
  const svg = generateProductOGSVG('changelog', 'Changelog', '', latest ? `latest · ${latest}` : 'release notes');
  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
