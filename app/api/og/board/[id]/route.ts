import { NextResponse } from 'next/server';
import { getPublicItem } from '@/lib/board';
import { generateProductOGSVG } from '@/lib/product-og';

export const dynamic = 'force-dynamic';

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** Imagen OG de un ítem del board: mismo lenguaje que las de producto, con el título. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const item = await getPublicItem(id);
  const svg = generateProductOGSVG('feedback', 'Feedback', '', item ? clip(item.title, 64) : 'feedback.zerosoft.ai');
  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600, s-maxage=3600',
    },
  });
}
