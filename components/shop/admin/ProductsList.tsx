'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import type { ProductListItem } from '@/lib/shop';
import { ShopDialog, StatusBadge, api, useErrorText, useMoney, useToast } from './shop-ui';

type BulkAction = 'active' | 'draft' | 'archived' | 'sale' | 'end-sale' | 'adjust' | 'delete';

interface ImportSummary {
  format: string;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row?: number; handle?: string; error: string }>;
  imagesFailed: number;
  imagesPending: number;
}

/** Productos: búsqueda, estado, importar (Shopify / Tiendanube) y exportar CSV. */
export default function ProductsList({ initial, total, currency, q, status, facets }: { initial: ProductListItem[]; total: number; currency: string; q: string; status: string; facets: { tag: string; vendor: string; type: string } }) {
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
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<BulkAction>('active');
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [percent, setPercent] = useState('');
  const [priceBusy, setPriceBusy] = useState(false);
  const [priceError, setPriceError] = useState('');
  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const allSelected = initial.length > 0 && selected.length === initial.length;
  const runBulk = async () => {
    setConfirmBulk(false);
    const res = await api('/api/shop/products/bulk', { method: 'POST', json: { ids: selected, action: bulkAction } });
    if (!res.ok) return push(errText(res.data.error ?? ''), 'bad');
    setSelected([]);
    router.refresh();
  };
  const applyBulk = () => {
    if (bulkAction === 'delete') return setConfirmBulk(true);
    if (bulkAction === 'sale' || bulkAction === 'adjust' || bulkAction === 'end-sale') {
      setPercent('');
      setPriceError('');
      return setPriceOpen(true);
    }
    void runBulk();
  };
  const pct = Number(percent.replace(',', '.'));
  const pctValid = bulkAction === 'end-sale' || (percent.trim() !== '' && Number.isFinite(pct) && (bulkAction === 'sale' ? pct >= 1 && pct <= 90 : pct !== 0 && pct >= -90 && pct <= 500));
  const runPrices = async (e: FormEvent) => {
    e.preventDefault();
    if (!pctValid || priceBusy) return setPriceError(t(bulkAction === 'sale' ? 'products.pricesSaleRange' : 'products.pricesAdjustRange'));
    setPriceBusy(true);
    const change = bulkAction === 'end-sale' ? { mode: 'end-sale' } : { mode: bulkAction, percent: Math.round(pct * 100) / 100 };
    const res = await api<{ products: number; variants: number }>('/api/shop/products/bulk', { method: 'POST', json: { ids: selected, action: 'prices', change } });
    setPriceBusy(false);
    if (!res.ok) return setPriceError(errText(res.data.error ?? ''));
    setPriceOpen(false);
    push(res.data.variants ? t('products.pricesDone', { n: res.data.variants }) : t('products.pricesNone'));
    setSelected([]);
    router.refresh();
  };

  const hrefWith = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const cur: Record<string, string> = { q, status, ...facets };
    for (const [k, v] of Object.entries({ ...cur, ...over })) if (v) params.set(k, v);
    return `/app/shop/products${params.size ? `?${params}` : ''}`;
  };
  const activeFacets = (['tag', 'vendor', 'type'] as const).filter((k) => facets[k]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    router.push(hrefWith({ q: query.trim() }));
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
              href={hrefWith({ status: s })}
            >
              {s ? t(`productStatus.${s}`) : t('products.all')}
            </Link>
          ))}
        </div>
      </div>
      {activeFacets.length > 0 && (
        <ul className="shop-facets" data-testid="shop-product-facets" aria-label={t('products.activeFilters')}>
          {activeFacets.map((k) => (
            <li key={k}>
              <Link className="shop-facet" data-testid={`shop-facet-${k}`} href={hrefWith({ [k]: '' })} aria-label={t('products.removeFilter', { kind: t(`products.facet.${k}`), value: facets[k] })}>
                {t(`products.facet.${k}`)}: {facets[k]} ×
              </Link>
            </li>
          ))}
        </ul>
      )}
      {initial.length === 0 ? (
        q || status || activeFacets.length > 0 ? (
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
          {selected.length > 0 && (
            <div className="shop-bulkbar" role="region" aria-label={t('products.bulkLabel')} data-testid="shop-bulkbar">
              <span>{t('products.selected', { n: selected.length })}</span>
              <select className="select" value={bulkAction} onChange={(e) => setBulkAction(e.target.value as typeof bulkAction)} aria-label={t('products.bulkLabel')}>
                <option value="active">{t('products.bulkActive')}</option>
                <option value="draft">{t('products.bulkDraft')}</option>
                <option value="archived">{t('products.bulkArchive')}</option>
                <option value="sale">{t('products.bulkSale')}</option>
                <option value="end-sale">{t('products.bulkEndSale')}</option>
                <option value="adjust">{t('products.bulkAdjust')}</option>
                <option value="delete">{t('products.bulkDelete')}</option>
              </select>
              <button type="button" className={`btn btn-sm ${bulkAction === 'delete' ? 'btn-danger' : 'btn-primary'}`} onClick={applyBulk} data-testid="shop-bulk-apply">
                {t('products.bulkApply')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>
                {t('common.cancel')}
              </button>
            </div>
          )}
          <table className="table shop-table">
            <caption className="sr-only">{t('products.caption', { n: total })}</caption>
            <thead>
              <tr>
                <th scope="col" className="shop-check-col">
                  <input type="checkbox" checked={allSelected} aria-label={t('products.selectAll')} onChange={(e) => setSelected(e.target.checked ? initial.map((p) => p.id) : [])} />
                </th>
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
                <tr key={p.id} aria-selected={selected.includes(p.id) || undefined}>
                  <td className="shop-check-col">
                    <input type="checkbox" checked={selected.includes(p.id)} aria-label={t('products.selectOne', { title: p.title })} onChange={() => toggle(p.id)} />
                  </td>
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
                    {(p.vendor || p.productType) && (
                      <span className="shop-rowfacets">
                        {p.vendor && (
                          <Link className="shop-facet-link" data-testid="shop-facet-add-vendor" href={hrefWith({ vendor: p.vendor })}>
                            {p.vendor}
                          </Link>
                        )}
                        {p.productType && (
                          <Link className="shop-facet-link" data-testid="shop-facet-add-type" href={hrefWith({ type: p.productType })}>
                            {p.productType}
                          </Link>
                        )}
                      </span>
                    )}
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
      <ConfirmDialog
        open={confirmBulk}
        danger
        title={t('products.bulkDeleteTitle', { n: selected.length })}
        body={t('products.bulkDeleteBody')}
        confirmLabel={t('editor.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void runBulk()}
        onCancel={() => setConfirmBulk(false)}
      />
      <ShopDialog open={priceOpen} title={t(`products.pricesTitle.${bulkAction === 'sale' ? 'sale' : bulkAction === 'adjust' ? 'adjust' : 'endSale'}`, { n: selected.length })} onClose={() => !priceBusy && setPriceOpen(false)}>
        <form onSubmit={runPrices} noValidate data-testid="shop-prices-form">
          <div className="ui-modal-body">
            {bulkAction === 'end-sale' ? (
              <p className="ui-help">{t('products.pricesEndSaleHelp')}</p>
            ) : (
              <>
                <label className="ui-field">
                  <span className="label">{t(bulkAction === 'sale' ? 'products.pricesSalePercent' : 'products.pricesAdjustPercent')}</span>
                  <input
                    className="input"
                    name="percent"
                    inputMode="decimal"
                    autoFocus
                    value={percent}
                    onChange={(e) => (setPercent(e.target.value), setPriceError(''))}
                    aria-invalid={priceError ? true : undefined}
                    aria-describedby="shop-prices-help"
                  />
                </label>
                <p className="ui-help" id="shop-prices-help">
                  {t(bulkAction === 'sale' ? 'products.pricesSaleHelp' : 'products.pricesAdjustHelp')}
                </p>
              </>
            )}
            {priceError && (
              <p className="ui-error" role="alert">
                {priceError}
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-secondary" onClick={() => setPriceOpen(false)} disabled={priceBusy}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" aria-busy={priceBusy} disabled={priceBusy}>
              {t('products.pricesApply')}
            </button>
          </div>
        </form>
      </ShopDialog>
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
                {summary.imagesPending > 0 && (
                  <p className="ui-help" data-testid="shop-import-pending">
                    {t('products.importImagesPending', { n: summary.imagesPending })}
                  </p>
                )}
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
