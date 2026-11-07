import ZeroTorus from '@/components/zero/ZeroTorus';
import ZeroArt from '@/components/zero/ZeroArt';
import { PRODUCT_FIGURES } from '@/lib/zero-art/catalog';
import type { ProductKey } from '@/lib/products';

/**
 * La pieza visual del primer viewport. En el home y el catálogo, el cero en 3D
 * (ZeroTorus); en la página de una app, una figura de lo que esa app hace, en
 * su color (ZeroArt). Con `caption` va como figura, con su epígrafe en mono
 * ("fig. 0 · …") y, si se puede girar, la pista.
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
  const art = focus ? <ZeroArt figure={PRODUCT_FIGURES[focus]} /> : <ZeroTorus />;
  if (!caption) return <div className={cls}>{art}</div>;
  return (
    <figure className={`${cls} has-caption`}>
      {art}
      <figcaption className="fig-cap hero-fig-cap">
        <span>{caption}</span>
        {hint && <span className="fig-cap-hint">{hint}</span>}
      </figcaption>
    </figure>
  );
}
