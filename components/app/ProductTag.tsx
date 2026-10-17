import type { CSSProperties } from 'react';
import { productColor } from '@/lib/product-taxonomy';

/** Producto como un tramo corto de su línea (no un punto: los círculos son estaciones) más el nombre. */
export default function ProductTag({ product, label }: { product: string; label: string }) {
  return (
    <span className="st-product" style={{ '--line': productColor(product) } as CSSProperties}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}
