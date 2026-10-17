import { Link } from '@/i18n/navigation';
import LineGlyph from '@/components/brand/LineGlyph';
import type { ProductKey } from '@/lib/products';
import { PRODUCT_NAMES, SITE_PRODUCTS } from './catalog';

/** Las once líneas como links, al pie de la banda de cierre. */
export default function EndLines({ label, current }: { label: string; current?: ProductKey }) {
  return (
    <ul className="end-lines" aria-label={label}>
      {SITE_PRODUCTS.map((k) => (
        <li key={k}>
          <Link href={`/products/${k}`} aria-current={k === current ? 'page' : undefined}>
            <LineGlyph product={k} size={12} onLine />
            {PRODUCT_NAMES[k]}
          </Link>
        </li>
      ))}
    </ul>
  );
}
