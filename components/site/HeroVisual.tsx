'use client';

import type { ReactNode } from 'react';
import ZeroField from '@/components/ZeroField';
import { useBrand } from '@/components/brand/BrandProvider';
import { PRODUCT_KEYS, productRgb, type ProductKey } from '@/lib/products';

const ACCENTS = PRODUCT_KEYS.map(productRgb);

/**
 * La pieza visual del primer viewport según el tema: en default, un cero
 * hecho de ceros (ZeroField, teñido con el producto en su página); en subte,
 * el plano de la red que llega como `map`.
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
    <div className={`hero-field ${className}`.trim()} aria-hidden="true">
      {focus ? (
        <ZeroField align="center" sizeFactor={0.92} color={productRgb(focus)} alpha={0.95} />
      ) : (
        <ZeroField align="center" sizeFactor={0.86} accents={ACCENTS} />
      )}
    </div>
  );
}
