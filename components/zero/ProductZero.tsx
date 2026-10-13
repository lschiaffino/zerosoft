import type { ProductKey } from '@/lib/products';
import ZeroMark from './ZeroMark';

/**
 * La marca de cada app: un cero chico en el color del producto (--c-<key>).
 * Reemplaza los puntos de color en listas, menús y tablas.
 */
export default function ProductZero({ product, size = 12 }: { product: ProductKey; size?: number }) {
  return <ZeroMark size={size} className={`product-zero card-${product}`} />;
}
