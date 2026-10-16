'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BOARD_SORTS, ROADMAP_PUBLIC_STATUSES } from '@/lib/roadmap-constants';
import { PRODUCT_KEYS } from '@/lib/product-taxonomy';

/**
 * Búsqueda, producto, estado, orden y vista del board. Todo vive en la URL
 * (?q=&product=&status=&sort=&view=) para que se pueda compartir.
 * `basePath` lo calcula el servidor (boardPath): en feedback.zerosoft.ai el
 * path visible no trae /feedback-board, y así server y cliente coinciden.
 */
export default function BoardFilters({
  labels,
  view,
  basePath,
}: {
  labels: {
    search: string;
    allProducts: string;
    allStatuses: string;
    sortLabel: string;
    productLabel: string;
    statusLabel: string;
    list: string;
    columns: string;
    /** Ya formateado ("12 ideas"). */
    count: string;
    sort: Record<string, string>;
    status: Record<string, string>;
    product: Record<string, string>;
  };
  view: 'list' | 'columns';
  basePath: string;
}) {
  const router = useRouter();
  const pathname = basePath;
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  function hrefWith(patch: Record<string, string | null>): string {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  function update(patch: Record<string, string | null>) {
    router.push(hrefWith(patch), { scroll: false });
  }

  // Búsqueda con debounce.
  useEffect(() => {
    const current = params.get('q') ?? '';
    if (q === current) return;
    const id = setTimeout(() => update({ q: q.trim() || null }), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="bp-toolbar">
      <input
        className="input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={labels.search}
        aria-label={labels.search}
      />
      <select
        className="select"
        value={params.get('product') ?? ''}
        onChange={(e) => update({ product: e.target.value || null })}
        aria-label={labels.productLabel}
      >
        <option value="">{labels.allProducts}</option>
        {PRODUCT_KEYS.map((p) => (
          <option key={p} value={p}>
            {labels.product[p]}
          </option>
        ))}
      </select>
      {view === 'list' && (
        <>
          <select
            className="select"
            value={params.get('status') ?? ''}
            onChange={(e) => update({ status: e.target.value || null })}
            aria-label={labels.statusLabel}
          >
            <option value="">{labels.allStatuses}</option>
            {ROADMAP_PUBLIC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {labels.status[s]}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={params.get('sort') ?? 'top'}
            onChange={(e) => update({ sort: e.target.value === 'top' ? null : e.target.value })}
            aria-label={labels.sortLabel}
          >
            {BOARD_SORTS.map((s) => (
              <option key={s} value={s}>
                {labels.sort[s]}
              </option>
            ))}
          </select>
        </>
      )}
      <span className="bp-view">
        <a href={hrefWith({ view: null })} aria-current={view === 'list'}>
          {labels.list}
        </a>
        <a href={hrefWith({ view: 'columns', status: null, sort: null })} aria-current={view === 'columns'}>
          {labels.columns}
        </a>
      </span>
      <span className="bp-count">{labels.count}</span>
    </div>
  );
}
