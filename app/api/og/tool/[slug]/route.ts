import { NextResponse } from 'next/server';
import { generateProductOGSVG } from '@/lib/product-og';
import { PRODUCT_CONFIG } from '@/lib/products';
import { getTool, TOOLS } from '@/lib/tools/registry';

export const dynamic = 'force-static';

const UPPER = new Set(['qr', 'utm', 'saas', 'ai']);

/** Nombre corto para la imagen (una sola OG por herramienta, en inglés). */
function shortName(slug: string): string {
  return slug
    .replace(/-(generator|calculator|builder|writer)$/, '')
    .split('-')
    .map((w) => (UPPER.has(w) ? (w === 'saas' ? 'SaaS' : w.toUpperCase()) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function generateStaticParams() {
  return [{ slug: 'hub' }, ...TOOLS.map((t) => ({ slug: t.slug }))];
}

export async function GET(_req: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const tool = getTool(slug);
  const name = tool ? shortName(tool.slug) : 'Free tools';
  const color = tool ? PRODUCT_CONFIG[tool.accent].color : undefined;
  const svg = generateProductOGSVG(`tool:${slug}`, name, '', 'free · no sign-up', color);
  return new NextResponse(svg, {
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
}
