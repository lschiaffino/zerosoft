'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { LocationDto } from '@/lib/shop';
import type { PurchaseOrderDto } from '@/lib/shop-ops';
import { MoneyInput, ShopDialog, api, useDate, useErrorText, useMoney, useToast } from './shop-ui';

const BADGE: Record<string, string> = { ordered: 'badge-info', partial: 'badge-warn', received: 'badge-ok', cancelled: 'badge-outline' };

type DraftLine = { variantId: string; quantity: string; cost: number | null };

/** Órdenes de compra: lo que se le pidió a cada proveedor y su recepción, que suma al stock. */
export default function PurchaseOrders({ initial, locations, variants, currency }: { initial: PurchaseOrderDto[]; locations: LocationDto[]; variants: Array<{ id: string; title: string }>; currency: string }) {
  const t = useTranslations('shop');
  const router = useRouter();
  const money = useMoney(currency);
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ supplier: string; locationId: string; lines: DraftLine[] } | null>(null);
  const [receive, setReceive] = useState<{ po: PurchaseOrderDto; qty: Record<string, string> } | null>(null);
  const [cancel, setCancel] = useState<PurchaseOrderDto | null>(null);
  const open = () => setForm({ supplier: '', locationId: locations.find((l) => l.isDefault)?.id ?? locations[0]?.id ?? '', lines: [{ variantId: variants[0]?.id ?? '', quantity: '1', cost: null }] });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    const res = await api('/api/shop/purchase-orders', {
      method: 'POST',
      json: { supplier: form.supplier, locationId: form.locationId, items: form.lines.filter((l) => l.variantId).map((l) => ({ variantId: l.variantId, quantity: Math.max(1, Number(l.quantity) || 1), unitCostCents: l.cost ?? 0 })) },
    });
    setBusy(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setForm(null);
    push(t('editor.saved'));
    router.refresh();
  };
  const doReceive = async (e: FormEvent) => {
    e.preventDefault();
    if (!receive) return;
    setBusy(true);
    const res = await api(`/api/shop/purchase-orders/${receive.po.id}`, { method: 'POST', json: { lines: Object.entries(receive.qty).map(([itemId, q]) => ({ itemId, quantity: Number(q) || 0 })) } });
    setBusy(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setReceive(null);
    push(t('purchasing.received'));
    router.refresh();
  };
  const doCancel = async () => {
    const res = await api(`/api/shop/purchase-orders/${cancel!.id}`, { method: 'DELETE' });
    setCancel(null);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.refresh();
  };

  return (
    <div className="app-page ui-page shop-page">
      <PageHeader
        back={{ href: '/app/shop/inventory', label: t('nav.inventory') }}
        title={t('purchasing.title')}
        description={t('purchasing.desc')}
        actions={variants.length > 0 ? <button type="button" className="btn btn-primary" onClick={open}>{t('purchasing.new')}</button> : undefined}
      />
      {initial.length === 0 ? (
        variants.length > 0 ? (
          <EmptyState product="shop" title={t('purchasing.emptyTitle')} body={t('purchasing.emptyBody')} />
        ) : (
          <EmptyState product="shop" title={t('purchasing.emptyTitle')} body={t('purchasing.needProducts')} action={{ label: t('products.new'), href: '/app/shop/products/new' }} />
        )
      ) : (
        <ul className="shop-return-list" data-testid="po-list">
          {initial.map((po) => (
            <li key={po.id} className="panel shop-panel" data-status={po.status}>
              <div className="shop-panel-head">
                <h2 className="shop-panel-title">PO-{po.number} · {po.supplier}</h2>
                <span className={`badge ${BADGE[po.status]}`}>{t(`purchasing.status.${po.status}`)}</span>
              </div>
              <p className="shop-rowmeta">{po.locationName} · {date(po.createdAt, false)}</p>
              <ul className="shop-items">
                {po.items.map((i) => (
                  <li key={i.id}>
                    <span className="shop-rowtext"><span className="shop-rowtitle">{i.title}</span></span>
                    <span className="data">{t('purchasing.receivedOf', { received: i.received, total: i.quantity })}</span>
                    <span className="data">{i.unitCostCents ? money(i.unitCostCents * i.quantity) : ''}</span>
                  </li>
                ))}
              </ul>
              {(po.status === 'ordered' || po.status === 'partial') && (
                <div className="shop-actions-row">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setReceive({ po, qty: Object.fromEntries(po.items.map((i) => [i.id, String(i.quantity - i.received)])) })}>{t('purchasing.receive')}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCancel(po)}>{t('purchasing.cancel')}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {variants.length === 0 && initial.length > 0 && <p className="ui-help shop-note"><Link href="/app/shop/products/new">{t('products.new')}</Link></p>}
      <ShopDialog open={!!form} wide title={t('purchasing.new')} onClose={() => setForm(null)}>
        {form && (
          <form onSubmit={create}>
            <div className="ui-modal-body">
              <div className="ui-fields-2">
                <label className="ui-field">
                  <span className="label">{t('purchasing.supplier')}</span>
                  <input className="input" required autoFocus maxLength={120} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} name="supplier" />
                </label>
                <label className="ui-field">
                  <span className="label">{t('purchasing.destination')}</span>
                  <select className="select" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
              </div>
              {form.lines.map((l, i) => {
                const set = (patch: Partial<DraftLine>) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <div key={i} className="shop-po-line">
                    <label className="ui-field">
                      <span className="label">{t('purchasing.product')}</span>
                      <select className="select" value={l.variantId} onChange={(e) => set({ variantId: e.target.value })}>
                        {variants.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
                      </select>
                    </label>
                    <label className="ui-field">
                      <span className="label">{t('drafts.quantity')}</span>
                      <input className="input shop-num-input" type="number" min={1} required value={l.quantity} onChange={(e) => set({ quantity: e.target.value })} />
                    </label>
                    <label className="ui-field">
                      <span className="label">{t('purchasing.unitCost', { currency })}</span>
                      <MoneyInput id={`po-${i}`} label={t('purchasing.unitCost', { currency })} value={l.cost} onChange={(c) => set({ cost: c })} />
                    </label>
                    {form.lines.length > 1 && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}>{t('editor.remove')}</button>
                    )}
                  </div>
                );
              })}
              <button type="button" className="btn btn-secondary btn-sm shop-self-start" onClick={() => setForm({ ...form, lines: [...form.lines, { variantId: variants[0]?.id ?? '', quantity: '1', cost: null }] })}>{t('purchasing.addLine')}</button>
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>{t('common.cancel')}</button>
              <button type="submit" className="btn btn-primary" aria-busy={busy} disabled={busy}>{t('purchasing.create')}</button>
            </div>
          </form>
        )}
      </ShopDialog>
      <ShopDialog open={!!receive} title={t('purchasing.receiveTitle', { n: receive?.po.number ?? 0 })} onClose={() => setReceive(null)}>
        {receive && (
          <form onSubmit={doReceive}>
            <div className="ui-modal-body">
              {receive.po.items.map((i) => (
                <label key={i.id} className="ui-field">
                  <span className="label">{i.title} ({t('purchasing.receivedOf', { received: i.received, total: i.quantity })})</span>
                  <input className="input shop-num-input" type="number" min={0} max={i.quantity - i.received} value={receive.qty[i.id] ?? '0'} onChange={(e) => setReceive({ ...receive, qty: { ...receive.qty, [i.id]: e.target.value } })} />
                </label>
              ))}
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setReceive(null)}>{t('common.cancel')}</button>
              <button type="submit" className="btn btn-primary" aria-busy={busy} disabled={busy}>{t('purchasing.receive')}</button>
            </div>
          </form>
        )}
      </ShopDialog>
      <ConfirmDialog open={!!cancel} danger title={t('purchasing.cancelTitle', { n: cancel?.number ?? 0 })} body={t('purchasing.cancelBody')} confirmLabel={t('purchasing.cancel')} cancelLabel={t('common.back')} onConfirm={() => void doCancel()} onCancel={() => setCancel(null)} />
      {toast}
    </div>
  );
}
