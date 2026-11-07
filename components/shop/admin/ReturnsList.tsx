'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { ReturnDto } from '@/lib/shop-ops';
import { MoneyInput, ShopDialog, api, useDate, useErrorText, useMoney, useToast } from './shop-ui';
import { OrdersNav } from './OrdersList';

const STATUS_BADGE: Record<string, string> = { requested: 'badge-warn', approved: 'badge-info', received: 'badge-ok', declined: 'badge-outline' };

/** Una devolución con sus acciones: aprobar, rechazar y recibir (con reposición y reembolso). También la usa el pedido. */
export function ReturnCard({ r, currency, canAdmin, onChange }: { r: ReturnDto; currency: string; canAdmin: boolean; onChange: () => void }) {
  const t = useTranslations('shop');
  const money = useMoney(currency);
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [receive, setReceive] = useState<{ restock: boolean; refund: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (json: Record<string, unknown>) => {
    setBusy(true);
    const res = await api(`/api/shop/returns/${r.id}`, { method: 'POST', json });
    setBusy(false);
    if (!res.ok) {
      push(errText(res.data.error), 'bad');
      return false;
    }
    onChange();
    return true;
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (receive && (await act({ action: 'receive', restock: receive.restock, refundCents: receive.refund ?? 0 }))) setReceive(null);
  };
  return (
    <div className="shop-return" data-testid="shop-return" data-status={r.status}>
      <div className="shop-return-head">
        <span className={`badge ${STATUS_BADGE[r.status] ?? 'badge-outline'}`}>{t(`returns.status.${r.status}`)}</span>
        <span className="shop-rowmeta">{t(`returns.reasons.${r.reason}`)} · {date(r.createdAt)}{r.fromCustomer ? ` · ${t('returns.fromCustomer')}` : ''}</span>
      </div>
      <ul className="shop-return-items">
        {r.items.map((i) => (
          <li key={i.itemId}>{i.title}{i.variantTitle ? ` (${i.variantTitle})` : ''} × {i.quantity}</li>
        ))}
      </ul>
      {r.note && <p className="shop-customer-note">{r.note}</p>}
      {r.status === 'received' && (
        <p className="shop-rowmeta">
          {r.refundCents > 0 ? t('returns.refundedAmount', { amount: money(r.refundCents) }) : t('returns.noRefund')} · {r.restocked ? t('returns.restocked') : t('returns.notRestocked')}
        </p>
      )}
      {(r.status === 'requested' || r.status === 'approved') && (
        <div className="shop-actions-row">
          {r.status === 'requested' && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act({ action: 'approve' })}>{t('returns.approve')}</button>
          )}
          {r.status === 'approved' && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => setReceive({ restock: true, refund: null })}>{t('returns.receive')}</button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void act({ action: 'decline' })}>{t('returns.decline')}</button>
        </div>
      )}
      <ShopDialog open={!!receive} title={t('returns.receiveTitle')} onClose={() => setReceive(null)}>
        {receive && (
          <form onSubmit={submit}>
            <div className="ui-modal-body">
              <label className="ui-check">
                <input type="checkbox" checked={receive.restock} onChange={(e) => setReceive({ ...receive, restock: e.target.checked })} />
                <span>{t('returns.restockLabel')}</span>
              </label>
              {canAdmin ? (
                <label className="ui-field">
                  <span className="label">{t('returns.refundLabel', { currency })}</span>
                  <MoneyInput id={`ret-${r.id}`} label={t('returns.refundLabel', { currency })} value={receive.refund} onChange={(c) => setReceive({ ...receive, refund: c })} />
                  <span className="ui-help">{t('returns.refundHelp')}</span>
                </label>
              ) : (
                <p className="ui-help">{t('returns.refundAdminOnly')}</p>
              )}
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setReceive(null)}>{t('common.cancel')}</button>
              <button type="submit" className="btn btn-primary" aria-busy={busy} disabled={busy}>{t('returns.receiveConfirm')}</button>
            </div>
          </form>
        )}
      </ShopDialog>
      {toast}
    </div>
  );
}

export default function ReturnsList({ initial, currency, status, canAdmin }: { initial: ReturnDto[]; currency: string; status: string; canAdmin: boolean }) {
  const t = useTranslations('shop');
  const router = useRouter();
  const tabs = ['', 'requested', 'approved', 'received', 'declined'];
  return (
    <div className="app-page ui-page shop-page">
      <PageHeader title={t('returns.title')} description={t('returns.desc')} />
      <OrdersNav active="returns" />
      <div className="ui-tabs shop-filter" role="tablist" aria-label={t('returns.title')}>
        {tabs.map((s) => (
          <Link key={s || 'all'} role="tab" className="ui-tab" aria-selected={status === s} href={`/app/shop/returns${s ? `?status=${s}` : ''}`}>
            {s ? t(`returns.status.${s}`) : t('products.all')}
          </Link>
        ))}
      </div>
      {initial.length === 0 ? (
        status ? <EmptyState compact body={t('returns.noMatch')} /> : <EmptyState product="shop" title={t('returns.emptyTitle')} body={t('returns.emptyBody')} />
      ) : (
        <ul className="shop-return-list">
          {initial.map((r) => (
            <li key={r.id} className="panel shop-panel">
              <Link href={`/app/shop/orders/${r.orderId}`} className="shop-rowtitle">{t('order.title', { n: r.orderNumber })}</Link>
              <span className="shop-rowmeta">{r.email}</span>
              <ReturnCard r={r} currency={currency || r.currency} canAdmin={canAdmin} onChange={() => router.refresh()} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
