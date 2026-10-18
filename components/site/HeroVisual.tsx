'use client';

import ZeroTorus from '@/components/zero/ZeroTorus';
import type { ProductKey } from '@/lib/products';

/**
 * La pieza visual del primer viewport: el cero en 3D hecho de ceros
 * (ZeroTorus), en el color del producto en su página.
 */
export default function HeroVisual({ focus, className = '' }: { focus?: ProductKey; className?: string }) {
  return (
    <div className={`hero-field ${focus ? `card-${focus}` : ''} ${className}`.trim()}>
      <ZeroTorus />
    </div>
  );
}
