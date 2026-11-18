'use client';

import { useMemo, useState } from 'react';
import { isZeroDecimalCurrency } from '@/lib/shop-money';
import type { ProductCard } from '@/lib/shop-storefront';
import type { StorefrontStrings } from '@/lib/shop-i18n';
import ProductGrid from './ProductGrid';

type Sort = 'manual' | 'newest' | 'price-asc' | 'price-desc' | 'title';

/** Colección con orden y filtros en el navegador: la página sigue en caché y los productos ya vienen. */
export default function CollectionProducts({ handle, products, currency, locale, t }: { handle: string; products: ProductCard[]; currency: string; locale: string; t: StorefrontStrings }) {
  const [sort, setSort] = useState<Sort>('manual');
  const [inStock, setInStock] = useState(false);
  const [max, setMax] = useState('');
  const shown = useMemo(() => {
    const limit = Number(max.replace(',', '.'));
    const cents = max.trim() && Number.isFinite(limit) ? Math.round(limit * 100) : null;
    const list = products.filter((p) => (!inStock || p.available) && (cents == null || p.priceCents <= cents));
    if (sort === 'price-asc') return [...list].sort((a, b) => a.priceCents - b.priceCents);
    if (sort === 'price-desc') return [...list].sort((a, b) => b.priceCents - a.priceCents);
    if (sort === 'title') return [...list].sort((a, b) => a.title.localeCompare(b.title, locale));
    if (sort === 'newest') return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list;
  }, [products, sort, inStock, max, locale]);
  return (
    <>
      {products.length > 1 && (
        <div className="sf-filters" data-testid="sf-filters">
          <label className="sf-field">
            <span>{t.sortBy}</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} name="sort">
              <option value="manual">{t.viewAll}</option>
              <option value="newest">{t.sortNewest}</option>
              <option value="price-asc">{t.sortPriceAsc}</option>
              <option value="price-desc">{t.sortPriceDesc}</option>
              <option value="title">{t.sortTitle}</option>
            </select>
          </label>
          <label className="sf-field">
            <span>{t.maxPrice} ({currency})</span>
            <input inputMode={isZeroDecimalCurrency(currency) ? 'numeric' : 'decimal'} value={max} onChange={(e) => setMax(e.target.value)} name="maxPrice" />
          </label>
          <label className="sf-check">
            <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} name="inStock" />
            <span>{t.inStockOnly}</span>
          </label>
        </div>
      )}
      {shown.length ? <ProductGrid handle={handle} products={shown} currency={currency} locale={locale} t={t} /> : <p className="sf-muted">{t.noMatch}</p>}
    </>
  );
}
