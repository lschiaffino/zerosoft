'use client';

import type { ReactNode } from 'react';
import ZeroTorus from '@/components/zero/ZeroTorus';
import { useBrand } from '@/components/brand/BrandProvider';
import type { ProductKey } from '@/lib/products';

/**
 * La pieza visual del primer viewport según el tema: en default, el cero en
 * 3D hecho de ceros (ZeroTorus, en el color del producto en su página); en
 * subte, el plano de la red que llega como `map`.
 */
export default function HeroVisual({
  map,
  focus,
  className = '',
}: {
  /** El plano de red (SiteNetworkMap) para el tema subte. */
  map: ReactNode;
  focus?: ProductKey;
  className?: string;
}) {
  const brand = useBrand();
  if (brand === 'subte') return <>{map}</>;
  return (
    <div className={`hero-field ${focus ? `card-${focus}` : ''} ${className}`.trim()}>
      <ZeroTorus />
    </div>
  );
}
