import { NextResponse } from 'next/server';
import { PRODUCT_CONFIG, PRODUCT_KEYS, isProductKey } from '@/lib/products';
import { generateProductOGSVG } from '@/lib/product-og';

export const dynamic = 'force-static';

export async function GET(_request: Request, props: { params: Promise<{ product: string }> }) {
  const params = await props.params;
  const { product } = params;
  if (!isProductKey(product)) {
    return new NextResponse('Not found', { status: 404 });
  }
  const cfg = PRODUCT_CONFIG[product];

  const svg = generateProductOGSVG(product, cfg.name, cfg.num);

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}

export function generateStaticParams() {
  return PRODUCT_KEYS.map((product) => ({ product }));
}
