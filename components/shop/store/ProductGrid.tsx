import Link from 'next/link';
import { formatMoney } from '@/lib/shop-money';
import type { ProductCard } from '@/lib/shop-storefront';
import type { StorefrontStrings } from '@/lib/shop-i18n';

/** Grilla de productos (server o client: sin estado). */
export default function ProductGrid({
  handle,
  products,
  currency,
  locale,
  t,
}: {
  handle: string;
  products: ProductCard[];
  currency: string;
  locale: string;
  t: Pick<StorefrontStrings, 'soldOut' | 'from' | 'sale'>;
}) {
  return (
    <ul className="sf-grid">
      {products.map((p) => (
        <li key={p.id} className="sf-card">
          <Link href={`/store/${handle}/products/${p.handle}`} className="sf-card-link">
            <span className="sf-card-img">
              {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span className="sf-card-ph" aria-hidden="true" />}
              {!p.available && <span className="sf-tag">{t.soldOut}</span>}
              {p.available && p.compareAtCents != null && p.compareAtCents > p.priceCents && <span className="sf-tag sf-tag-sale">{t.sale}</span>}
            </span>
            <span className="sf-card-title">{p.title}</span>
            <span className="sf-card-price">
              {p.maxPriceCents > p.priceCents ? `${t.from} ` : ''}
              {formatMoney(p.priceCents, currency, locale)}
              {p.compareAtCents != null && p.compareAtCents > p.priceCents && <s>{formatMoney(p.compareAtCents, currency, locale)}</s>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
