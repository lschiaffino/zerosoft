'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { ProductListItem } from '@/lib/shop';
import { ShopDialog, StatusBadge, useErrorText, useMoney, useToast } from './shop-ui';

interface ImportSummary {
  format: string;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row?: number; handle?: string; error: string }>;
  imagesFailed: number;
}

/** Productos: búsqueda, estado, importar (Shopify / Tiendanube) y exportar CSV. */
export default function ProductsList({ initial, total, currency, q, status }: { initial: ProductListItem[]; total: number; currency: string; q: string; status: string }) {
  const t = useTranslations('shop');
  const router = useRouter();
  const money = useMoney(currency);
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [query, setQuery] = useState(q);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [update, setUpdate] = useState(false);

  const search = (e: FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (status) params.set('status', status);
    router.push(`/app/shop/products${params.size ? `?${params}` : ''}`);
  };

  const doImport = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.set('file', file);
    if (update) form.set('update', '1');
    const res = await fetch('/api/shop/products/import', { method: 'POST', body: form });
    const data = (await res.json().catch(() => ({}))) as { summary?: ImportSummary; error?: string };
    setBusy(false);
    if (!res.ok || !data.summary) {
      push(errText(data.error), 'bad');
      return;
    }
    setSummary(data.summary);
    router.refresh();
  };

  const statuses = ['', 'active', 'draft', 'archived'];
  return (
    <div className="app-page ui-page shop-page">
      <PageHeader
        title={t('nav.products')}
        description={t('products.desc')}
        actions={
          <>
            <a className="btn btn-secondary" href="/api/shop/products/export" download>
              {t('products.export')}
            </a>
            <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(true)}>
              {t('products.import')}
            </button>
            <Link className="btn btn-primary" href="/app/shop/products/new">
              {t('products.new')}
            </Link>
          </>
        }
      />
      <div className="shop-toolbar">
        <form onSubmit={search} role="search" className="shop-search">
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('products.search')} aria-label={t('products.search')} />
        </form>
        <div className="ui-tabs shop-filter" role="tablist" aria-label={t('products.filter')}>
          {statuses.map((s) => (
            <Link
              key={s || 'all'}
              role="tab"
              aria-selected={status === s}
              className="ui-tab"
              href={`/app/shop/products${s || q ? `?${new URLSearchParams({ ...(q ? { q } : {}), ...(s ? { status: s } : {}) })}` : ''}`}
            >
              {s ? t(`productStatus.${s}`) : t('products.all')}
            </Link>
          ))}
        </div>
      </div>
      {initial.length === 0 ? (
        q || status ? (
          <EmptyState compact body={t('products.noMatch')} />
        ) : (
          <EmptyState
            product="shop"
            title={t('products.emptyTitle')}
            body={t('products.emptyBody')}
            action={{ label: t('products.new'), href: '/app/shop/products/new' }}
            secondary={
              <button type="button" className="shop-linkbtn" onClick={() => setImportOpen(true)}>
                {t('products.importHint')}
              </button>
            }
          />
        )
      ) : (
        <div className="table-wrap">
          <table className="table shop-table">
            <caption className="sr-only">{t('products.caption', { n: total })}</caption>
            <thead>
              <tr>
                <th scope="col">{t('products.colProduct')}</th>
                <th scope="col">{t('products.colStatus')}</th>
                <th scope="col" className="num">
                  {t('products.colStock')}
                </th>
                <th scope="col" className="num shop-hide-sm">
                  {t('products.colPrice')}
                </th>
              </tr>
            </thead>
            <tbody>
              {initial.map((p) => (
                <tr key={p.id}>
                  <th scope="row">
                    <Link href={`/app/shop/products/${p.id}`} className="shop-rowlink">
                      <span className="shop-thumb">{p.image ? <img src={p.image} alt="" /> : null}</span>
                      <span className="shop-rowtext">
                        <span className="shop-rowtitle">{p.title}</span>
                        <span className="shop-rowmeta">
                          {p.variants > 1 ? t('products.variants', { n: p.variants }) : p.productType || p.vendor}
                        </span>
                      </span>
                    </Link>
                  </th>
                  <td>
                    <StatusBadge status={p.status} kind="product" />
                  </td>
                  <td className="num">{p.tracked ? p.stock : t('products.notTracked')}</td>
                  <td className="num shop-hide-sm">{p.minPriceCents === p.maxPriceCents ? money(p.minPriceCents) : `${money(p.minPriceCents)} – ${money(p.maxPriceCents)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ShopDialog open={importOpen} title={t('products.importTitle')} onClose={() => !busy && (setImportOpen(false), setSummary(null))}>
        <form onSubmit={doImport}>
          <div className="ui-modal-body">
            <p className="ui-help">{t('products.importHelp')}</p>
            <label className="ui-field">
              <span className="label">{t('products.importFile')}</span>
              <input ref={fileRef} type="file" accept=".csv,text/csv" required className="input" />
            </label>
            <label className="ui-check">
              <input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} />
              <span>{t('products.importUpdate')}</span>
            </label>
            {summary && (
              <div className="shop-import-summary" role="status">
                <p>{t('products.importDone', { created: summary.created, updated: summary.updated, skipped: summary.skipped, format: summary.format === 'tiendanube' ? 'Tiendanube' : 'Shopify' })}</p>
                {summary.imagesFailed > 0 && <p className="ui-help">{t('products.importImagesFailed', { n: summary.imagesFailed })}</p>}
                {summary.errors.length > 0 && (
                  <ul className="shop-import-errors">
                    {summary.errors.slice(0, 10).map((er, i) => (
                      <li key={i}>
                        {er.row ? t('products.importRow', { row: er.row }) : er.handle}: {errText(er.error)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-secondary" onClick={() => (setImportOpen(false), setSummary(null))} disabled={busy}>
              {summary ? t('common.close') : t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" aria-busy={busy} disabled={busy}>
              {t('products.importRun')}
            </button>
          </div>
        </form>
      </ShopDialog>
      {toast}
    </div>
  );
}
