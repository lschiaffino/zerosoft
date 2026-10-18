import type { CSSProperties } from 'react';
import { productColor } from '@/lib/product-taxonomy';

/** Producto como una muestra cuadrada de su color más el nombre. */
export default function ProductTag({ product, label }: { product: string; label: string }) {
  return (
    <span className="st-product" style={{ '--line': productColor(product) } as CSSProperties}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}
