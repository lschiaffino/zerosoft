'use client';

import type { ProductKey } from '@/lib/products';
import ZeroMark from '@/components/zero/ZeroMark';

/** La marca de cada app: el cero en el color del producto. */
export default function ProductGlyph({
  product,
  size = 16,
  title,
  className = '',
}: {
  product: ProductKey;
  size?: number;
  title?: string;
  className?: string;
}) {
  return <ZeroMark size={Math.round(size * 1.1)} title={title} className={`product-zero card-${product} ${className}`.trim()} />;
}
