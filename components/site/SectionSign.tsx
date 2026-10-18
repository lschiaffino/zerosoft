import type { ReactNode } from 'react';
import BrandSymbol from '@/components/brand/BrandSymbol';
import ProductGlyph from '@/components/brand/ProductGlyph';
import type { ProductKey } from '@/lib/products';

/**
 * El cartel que abre cada sección del sitio: el cero y el título en
 * señalética sobre un filete. En la página de un producto, el cero va en el
 * color del producto.
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
          <ProductGlyph product={product} size={28} className="sign-mark" />
        ) : (
          <BrandSymbol size={28} className="sign-mark" />
        )}
        <h2 id={id} className="sign-title">
          {title}
          {sub && <span className="sign-sub">{sub}</span>}
        </h2>
      </div>
    </div>
  );
}
