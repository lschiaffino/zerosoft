import type { ReactNode } from 'react';
import Station from '@/components/brand/Station';
import LineGlyph from '@/components/brand/LineGlyph';
import type { ProductKey } from '@/lib/products';

/**
 * El cartel que abre cada sección del sitio: una banda negra de lado a lado
 * con una estación y el título en señalética. Reemplaza a los rótulos chicos
 * sobre el título. En la página de un producto, la estación lleva el anillo
 * del color de su línea.
 */
export default function SectionSign({
  id,
  title,
  sub,
  product,
}: {
  /** id del h2 (para aria-labelledby de la sección). */
  id: string;
  title: ReactNode;
  /** Segunda línea del cartel, en gris de banda. */
  sub?: ReactNode;
  product?: ProductKey;
}) {
  return (
    <div className="sign-band">
      <div className="container sign-inner">
        {product ? (
          <LineGlyph product={product} size={28} className="sign-station" />
        ) : (
          <Station size={28} ring="#ffffff" fill="#111111" className="sign-station" />
        )}
        <h2 id={id} className="sign-title">
          {title}
          {sub && <span className="sign-sub">{sub}</span>}
        </h2>
      </div>
    </div>
  );
}
