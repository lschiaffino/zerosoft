'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ProductCard } from '@/lib/shop-storefront';
import type { StorefrontStrings } from '@/lib/shop-i18n';
import ProductGrid from './ProductGrid';

export default function SearchView({ handle, currency, locale, t }: { handle: string; currency: string; locale: string; t: StorefrontStrings }) {
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [results, setResults] = useState<ProductCard[] | null>(null);
  const [error, setError] = useState(false);

  const run = async (term: string) => {
    if (!term.trim()) {
      setResults(null);
      return;
    }
    try {
      const res = await fetch(`/api/shop/public/${handle}/search?q=${encodeURIComponent(term.trim())}`);
      const data = (await res.json()) as { products?: ProductCard[] };
      setError(!res.ok);
      setResults(data.products ?? []);
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    const initial = sp.get('q');
    if (initial) void run(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    url.searchParams.set('q', q.trim());
    window.history.replaceState(null, '', url);
    void run(q);
  };

  return (
    <section className="sf-section">
      <h1 className="sf-h1">{t.searchTitle}</h1>
      <form className="sf-search" role="search" onSubmit={submit}>
        <label className="sf-sr" htmlFor="sf-q">
          {t.search}
        </label>
        <input id="sf-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.searchPlaceholder} autoFocus />
        <button type="submit" className="sf-btn sf-btn-primary">
          {t.search}
        </button>
      </form>
      {error && <p className="sf-error" role="alert">{t.errors.generic}</p>}
      {results && results.length === 0 && <p className="sf-muted">{t.noResults}</p>}
      {results && results.length > 0 && <ProductGrid handle={handle} products={results} currency={currency} locale={locale} t={t} />}
    </section>
  );
}
