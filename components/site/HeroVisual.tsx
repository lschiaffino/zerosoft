'use client';

import ZeroTorus from '@/components/zero/ZeroTorus';
import type { ProductKey } from '@/lib/products';

/**
 * La pieza visual del primer viewport: el cero en 3D hecho de ceros
 * (ZeroTorus), en el color del producto en su página. Con `caption` va como
 * figura, con su epígrafe en mono ("fig. 0 · …") y la pista para girarlo.
 */
export default function HeroVisual({
  focus,
  className = '',
  caption,
  hint,
}: {
  focus?: ProductKey;
  className?: string;
  caption?: string;
  hint?: string;
}) {
  const cls = `hero-field ${focus ? `card-${focus}` : ''} ${className}`.trim();
  if (!caption) {
    return (
      <div className={cls}>
        <ZeroTorus />
      </div>
    );
  }
  return (
    <figure className={`${cls} has-caption`}>
      <ZeroTorus />
      <figcaption className="fig-cap hero-fig-cap">
        <span>{caption}</span>
        {hint && <span className="fig-cap-hint">{hint}</span>}
      </figcaption>
    </figure>
  );
}
