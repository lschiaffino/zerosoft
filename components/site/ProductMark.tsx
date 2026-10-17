import LineGlyph from '@/components/brand/LineGlyph';
import Station from '@/components/brand/Station';
import { PRODUCT_KEYS, type ProductKey } from '@/lib/products';

/**
 * La marca de un producto de la taxonomía de feedback y changelog: las once
 * apps llevan su tramo de línea; plataforma, sitio y otros, una estación
 * negra sola (no tienen línea propia).
 */
export default function ProductMark({ product, size = 12 }: { product: string; size?: number }) {
  if ((PRODUCT_KEYS as string[]).includes(product)) {
    return <LineGlyph product={product as ProductKey} size={size} onLine />;
  }
  return <Station size={size} className="product-mark-station" />;
}
