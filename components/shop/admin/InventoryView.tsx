'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { InventoryLogDto, InventoryRow, LocationDto } from '@/lib/shop';
import { ShopDialog, api, useDate, useErrorText, useToast } from './shop-ui';

/** Inventario por variante y ubicación: ajustar, contar, stock bajo e historial. */
export default function InventoryView({
  initial,
  locations,
  history,
  lowOnly,
  threshold,
}: {
  initial: InventoryRow[];
  locations: LocationDto[];
  history: InventoryLogDto[];
  lowOnly: boolean;
  threshold: number;
}) {
  const t = useTranslations('shop');
  const router = useRouter();
  const sp = useSearchParams();
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [loc, setLoc] = useState('');
  const [edit, setEdit] = useState<{ row: InventoryRow; mode: 'delta' | 'set'; value: string; reason: string } | null>(null);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return initial.filter((r) => (!loc || r.locationId === loc) && (!term || `${r.productTitle} ${r.variantTitle} ${r.sku}`.toLowerCase().includes(term)));
  }, [initial, q, loc]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    const n = Number(edit.value);
    if (!Number.isInteger(n)) return;
    const res = await api('/api/shop/inventory', {
      method: 'POST',
      json: { variantId: edit.row.variantId, locationId: edit.row.locationId, ...(edit.mode === 'set' ? { set: n } : { delta: n }), reason: edit.reason },
    });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setEdit(null);
    push(t('inventory.saved'));
    router.refresh();
  };

  return (
    <div className="app-page ui-page shop-page">
      <PageHeader title={t('nav.inventory')} description={t('inventory.desc', { n: threshold })} />
      <div className="shop-toolbar">
        <input className="input shop-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('inventory.search')} aria-label={t('inventory.search')} />
        {locations.length > 1 && (
          <select className="select" value={loc} onChange={(e) => setLoc(e.target.value)} aria-label={t('inventory.location')}>
            <option value="">{t('inventory.allLocations')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <div className="ui-tabs shop-filter" role="tablist">
          <Link role="tab" className="ui-tab" aria-selected={!lowOnly} href="/app/shop/inventory">
            {t('products.all')}
          </Link>
          <Link role="tab" className="ui-tab" aria-selected={lowOnly} href="/app/shop/inventory?low=1">
            {t('inventory.lowOnly')}
          </Link>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          product="shop"
          compact={lowOnly || !!q}
          title={t('inventory.emptyTitle')}
          body={lowOnly ? t('inventory.noLow') : q ? t('products.noMatch') : t('inventory.emptyBody')}
          action={!lowOnly && !q ? { label: t('products.new'), href: '/app/shop/products/new' } : undefined}
        />
      ) : (
        <div className="table-wrap">
          <table className="table shop-table">
            <thead>
              <tr>
                <th scope="col">{t('products.colProduct')}</th>
                {locations.length > 1 && <th scope="col" className="shop-hide-sm">{t('inventory.location')}</th>}
                <th scope="col" className="num">
                  {t('inventory.reserved')}
                </th>
                <th scope="col" className="num">
                  {t('inventory.available')}
                </th>
                <th scope="col">
                  <span className="sr-only">{t('inventory.adjust')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.variantId}:${r.locationId}`} data-low={r.low || undefined}>
                  <th scope="row">
                    <Link href={`/app/shop/products/${r.productId}`} className="shop-rowtext">
                      <span className="shop-rowtitle">{r.productTitle}</span>
                      <span className="shop-rowmeta">{[r.variantTitle !== 'Default' ? r.variantTitle : '', r.sku].filter(Boolean).join(' · ')}</span>
                    </Link>
                  </th>
                  {locations.length > 1 && <td className="shop-hide-sm">{r.locationName}</td>}
                  <td className="num">{r.reserved}</td>
                  <td className="num">
                    {r.available}
                    {r.low && <span className="badge badge-warn shop-low">{t('inventory.low')}</span>}
                  </td>
                  <td>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdit({ row: r, mode: 'delta', value: '', reason: 'received' })}>
                      {t('inventory.adjust')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="ui-section shop-section" aria-labelledby="inv-history">
        <h2 className="ui-section-title" id="inv-history">
          {t('inventory.history')}
        </h2>
        {history.length === 0 ? (
          <p className="ui-help">{t('inventory.noHistory')}</p>
        ) : (
          <ul className="shop-timeline">
            {history.map((h) => (
              <li key={h.id}>
                <span className="data">{h.delta > 0 ? `+${h.delta}` : h.delta}</span> {h.productTitle}
                {h.variantTitle && h.variantTitle !== 'Default' ? ` (${h.variantTitle})` : ''} · {t(`inventory.reasons.${h.reason}`)} · {h.locationName} ·{' '}
                {t('inventory.after', { n: h.availableAfter })} · {date(h.createdAt)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ShopDialog open={!!edit} title={t('inventory.adjustTitle')} onClose={() => setEdit(null)}>
        {edit && (
          <form onSubmit={save}>
            <div className="ui-modal-body">
              <p>
                {edit.row.productTitle}
                {edit.row.variantTitle !== 'Default' ? ` (${edit.row.variantTitle})` : ''} · {edit.row.locationName}
              </p>
              <p className="ui-help">{t('inventory.current', { available: edit.row.available, reserved: edit.row.reserved })}</p>
              <fieldset className="ui-field shop-fieldset">
                <legend className="label">{t('inventory.mode')}</legend>
                <label className="ui-check">
                  <input type="radio" checked={edit.mode === 'delta'} onChange={() => setEdit({ ...edit, mode: 'delta', reason: 'received' })} />
                  <span>{t('inventory.modeDelta')}</span>
                </label>
                <label className="ui-check">
                  <input type="radio" checked={edit.mode === 'set'} onChange={() => setEdit({ ...edit, mode: 'set', reason: 'count', value: String(edit.row.available) })} />
                  <span>{t('inventory.modeSet')}</span>
                </label>
              </fieldset>
              <label className="ui-field">
                <span className="label">{edit.mode === 'set' ? t('inventory.available') : t('inventory.delta')}</span>
                <input className="input" type="number" required autoFocus min={edit.mode === 'set' ? 0 : undefined} value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} />
              </label>
              <label className="ui-field">
                <span className="label">{t('inventory.reason')}</span>
                <select className="select" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })}>
                  {['received', 'count', 'damaged', 'returned', 'correction', 'adjust'].map((r) => (
                    <option key={r} value={r}>
                      {t(`inventory.reasons.${r}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setEdit(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary">
                {t('common.save')}
              </button>
            </div>
          </form>
        )}
      </ShopDialog>
      {toast}
    </div>
  );
}
