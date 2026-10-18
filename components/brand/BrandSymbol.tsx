'use client';

import ZeroMark from '@/components/zero/ZeroMark';

/** El símbolo de la marca como viñeta (pasos, carteles): el cero, en el color del texto. */
export default function BrandSymbol({
  size = 16,
  title,
  className = '',
}: {
  size?: number;
  title?: string;
  className?: string;
}) {
  return <ZeroMark size={size} title={title} className={`brand-symbol ${className}`.trim()} />;
}
