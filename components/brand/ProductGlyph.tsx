'use client';

import type { ProductKey } from '@/lib/products';
import ZeroMark from '@/components/zero/ZeroMark';
import { useBrand } from './BrandProvider';
import SubteLineGlyph from './subte/SubteLineGlyph';

/**
 * La marca de cada app según el tema: en default, el cero en el color del
 * producto (ProductZero); en subte, su estación (`onLine` la dibuja sobre un
 * tramo de su línea). Un tema nuevo suma acá su caso.
 */
export default function ProductGlyph({
  product,
  size = 16,
  onLine = false,
  title,
  className = '',
}: {
  product: ProductKey;
  size?: number;
  /** Solo subte: la estación sobre un tramo de línea. */
  onLine?: boolean;
  title?: string;
  className?: string;
}) {
  const brand = useBrand();
  if (brand === 'subte') {
    return <SubteLineGlyph product={product} size={size} onLine={onLine} title={title} className={className} />;
  }
  return <ZeroMark size={Math.round(size * 1.1)} title={title} className={`product-zero card-${product} ${className}`.trim()} />;
}
