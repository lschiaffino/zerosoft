'use client';

import { useEffect, useMemo, useState } from 'react';
import { isZeroDecimalCurrency } from '@/lib/shop-money';
import { activeFilterCount, collectionFacets, filterProducts, filtersFromSearch, filtersToSearch, toggleOption, type CollectionFilters } from '@/lib/shop-filters';
import type { FilterableCard } from '@/lib/shop-storefront';
import { fmt, type StorefrontStrings } from '@/lib/shop-i18n';
import ProductGrid from './ProductGrid';

const SORTS = ['manual', 'newest', 'price-asc', 'price-desc', 'title'] as const;
type Sort = (typeof SORTS)[number];

function maxToCents(max: string): number | null {
  const limit = Number(max.replace(',', '.'));
  return max.trim() && Number.isFinite(limit) && limit >= 0 ? Math.round(limit * 100) : null;
}

/**
 * Colección con orden y filtros en el navegador: la página sigue en caché y
 * los productos (con sus variantes) ya vienen. Los filtros quedan en la URL
 * para compartir la colección filtrada.
 */
export default function CollectionProducts({ handle, products, currency, locale, t }: { handle: string; products: FilterableCard[]; currency: string; locale: string; t: StorefrontStrings }) {
  const [sort, setSort] = useState<Sort>('manual');
  const [inStock, setInStock] = useState(false);
  const [max, setMax] = useState('');
  const [options, setOptions] = useState<CollectionFilters['options']>({});
  const [ready, setReady] = useState(false);

  const filters = useMemo<CollectionFilters>(() => ({ inStock, maxCents: maxToCents(max), options }), [inStock, max, options]);
  const facets = useMemo(() => collectionFacets(products, filters), [products, filters]);

  // La URL manda al entrar (después de hidratar, para que el HTML del servidor coincida).
  useEffect(() => {
    const { filters: f, sort: s } = filtersFromSearch(window.location.search);
    const known = new Set(collectionFacets(products).map((x) => x.key));
    setOptions(Object.fromEntries(Object.entries(f.options).filter(([k]) => known.has(k))));
    setInStock(f.inStock);
    if (f.maxCents != null) setMax(String(f.maxCents / 100));
    if (s && (SORTS as readonly string[]).includes(s)) setSort(s as Sort);
    setReady(true);
  }, [products]);

  useEffect(() => {
    if (!ready) return;
    const url = `${window.location.pathname}${filtersToSearch(filters, sort)}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, '', url);
  }, [ready, filters, sort]);

  const shown = useMemo(() => {
    const list = filterProducts(products, filters);
    if (sort === 'price-asc') return [...list].sort((a, b) => a.priceCents - b.priceCents);
    if (sort === 'price-desc') return [...list].sort((a, b) => b.priceCents - a.priceCents);
    if (sort === 'title') return [...list].sort((a, b) => a.title.localeCompare(b.title, locale));
    if (sort === 'newest') return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list;
  }, [products, filters, sort, locale]);

  const active = activeFilterCount(filters);
  const clear = () => {
    setInStock(false);
    setMax('');
    setOptions({});
  };

  return (
    <>
      {products.length > 1 && (
        <div className="sf-filterbar">
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
              <span>
                {t.maxPrice} ({currency})
              </span>
              <input inputMode={isZeroDecimalCurrency(currency) ? 'numeric' : 'decimal'} value={max} onChange={(e) => setMax(e.target.value)} name="maxPrice" />
            </label>
            <label className="sf-check">
              <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} name="inStock" />
              <span>{t.inStockOnly}</span>
            </label>
          </div>
          {facets.map((f) => {
            const picked = options[f.key] ?? [];
            return (
              <fieldset key={f.key} className="sf-option sf-facet" data-testid="sf-facet" data-facet={f.key}>
                <legend>{f.key === 'p.vendor' ? t.filterVendor : f.key === 'p.type' ? t.filterType : f.label}</legend>
                <div className="sf-option-values">
                  {f.values.map((v) => {
                    const on = picked.includes(v.key);
                    return (
                      <button
                        key={v.key}
                        type="button"
                        className={`sf-chip${on ? ' is-active' : ''}`}
                        aria-pressed={on}
                        disabled={!on && v.count === 0}
                        data-value={v.key}
                        onClick={() => setOptions(toggleOption(filters, f.key, v.key).options)}
                      >
                        {v.label}
                        <span className="sf-chip-count" aria-hidden="true">
                          {v.count}
                        </span>
                        <span className="sf-sr">{fmt(t.filterCount, { count: v.count })}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
          <p className="sf-results" aria-live="polite" data-testid="sf-results">
            {active > 0 && (
              <>
                <span>{fmt(t.filterResults, { shown: shown.length, total: products.length })}</span>
                <button type="button" className="sf-link" onClick={clear} data-testid="sf-clear-filters">
                  {t.clearFilters}
                </button>
              </>
            )}
          </p>
        </div>
      )}
      {shown.length ? <ProductGrid handle={handle} products={shown} currency={currency} locale={locale} t={t} /> : <p className="sf-muted">{t.noMatch}</p>}
    </>
  );
}
