'use client';

import ZeroMark from '@/components/zero/ZeroMark';
import { useBrand } from './BrandProvider';
import Station from './Station';

/**
 * El símbolo de la marca como viñeta o hito (timeline, pasos, carteles):
 * en default el cero (hereda el color del texto); en subte, la estación.
 * `ring`/`fill` solo aplican al tema subte.
 */
export default function BrandSymbol({
  size = 16,
  ring,
  fill,
  title,
  className = '',
}: {
  size?: number;
  ring?: string;
  fill?: string;
  title?: string;
  className?: string;
}) {
  const brand = useBrand();
  if (brand === 'subte') {
    return <Station size={size} ring={ring} fill={fill} title={title} className={className} />;
  }
  return <ZeroMark size={size} title={title} className={`brand-symbol ${className}`.trim()} />;
}
