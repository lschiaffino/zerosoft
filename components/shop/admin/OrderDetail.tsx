'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { OrderDto } from '@/lib/shop-orders';
import { MoneyInput, ShopDialog, StatusBadge, api, useDate, useErrorText, useMoney, useToast } from './shop-ui';

/** Pedido: ítems, totales, cliente, envío, línea de tiempo y acciones (pagado, enviar, reembolsar, cancelar). */
export default function OrderDetail({ initial, storeHandle, canAdmin }: { initial: OrderDto; storeHandle: string; canAdmin: boolean }) {
  const t = useTranslations('shop');
  const router = useRouter();
  const [order, setOrder] = useState(initial);
  const money = useMoney(order.currency);
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [fulfill, setFulfill] = useState<{ number: string; company: string; url: string; notify: boolean } | null>(null);
  const [refund, setRefund] = useState<{ amount: number | null; restock: boolean; reason: string } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (path: string, json: unknown, ok: string) => {
    setBusy(true);
    const res = await api<{ order?: OrderDto }>(`/api/shop/orders/${order.id}/${path}`, { method: 'POST', json });
    setBusy(false);
    if (!res.ok || !res.data.order) {
      push(errText(res.data.error), 'bad');
      return false;
    }
    setOrder(res.data.order);
    push(ok);
    router.refresh();
    return true;
  };

  const doFulfill = async (e: FormEvent) => {
    e.preventDefault();
    if (!fulfill) return;
    if (await act('fulfill', { trackingNumber: fulfill.number, trackingCompany: fulfill.company, trackingUrl: fulfill.url, notify: fulfill.notify }, t('order.fulfilledToast'))) setFulfill(null);
  };
  const doRefund = async (e: FormEvent) => {
    e.preventDefault();
    if (!refund) return;
    if (await act('refund', { amountCents: refund.amount ?? undefined, restock: refund.restock, reason: refund.reason }, t('order.refundedToast'))) setRefund(null);
  };
  const addNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    if (await act('notes', { text: note }, t('order.noteAdded'))) setNote('');
  };

  const a = order.shippingAddress;
  const remaining = order.totalCents - order.refundedCents;
  return (
    <div className="app-page ui-page shop-page">
      <PageHeader
        back={{ href: '/app/shop/orders', label: t('nav.orders') }}
        title={t('order.title', { n: order.number })}
        description={`${date(order.createdAt)} · ${t(`order.method.${order.paymentMethod}`)}`}
        actions={
          <>
            <Link className="btn btn-secondary" href={`/app/shop/orders/${order.id}/packing-slip`}>
              {t('order.packingSlip')}
            </Link>
            {order.status === 'pending' && (
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmPaid(true)} disabled={busy}>
                {t('order.markPaid')}
              </button>
            )}
            {order.status === 'paid' && (
              <button type="button" className="btn btn-primary" onClick={() => setFulfill({ number: '', company: '', url: '', notify: true })} disabled={busy}>
                {t('order.fulfill')}
              </button>
            )}
          </>
        }
      />
      <div className="shop-order-status">
        <StatusBadge status={order.status} />
        {order.stockState === 'oversold' && <span className="badge badge-bad">{t('order.oversold')}</span>}
        {order.cancelReason === 'expired' && <span className="ui-help">{t('order.expired')}</span>}
      </div>
      <div className="shop-editor">
        <div className="shop-editor-main">
          <section className="panel shop-panel" aria-labelledby="ord-items">
            <h2 className="shop-panel-title" id="ord-items">
              {t('order.items')}
            </h2>
            <ul className="shop-items">
              {order.items.map((i) => (
                <li key={i.id}>
                  <span className="shop-thumb">{i.imageUrl ? <img src={i.imageUrl} alt="" /> : null}</span>
                  <span className="shop-rowtext">
                    {i.productId ? <Link href={`/app/shop/products/${i.productId}`}>{i.title}</Link> : i.title}
                    <span className="shop-rowmeta">{[i.variantTitle, i.sku].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="data">
                    {money(i.unitCents)} × {i.quantity}
                  </span>
                  <span className="data">{money(i.totalCents)}</span>
                </li>
              ))}
            </ul>
            <dl className="shop-totals">
              <dt>{t('order.subtotal')}</dt>
              <dd>{money(order.subtotalCents)}</dd>
              {order.discountCents > 0 && (
                <>
                  <dt>{t('order.discount', { code: order.discountCode ?? '' })}</dt>
                  <dd>−{money(order.discountCents)}</dd>
                </>
              )}
              {order.shippingName && (
                <>
                  <dt>{t('order.shipping', { name: order.shippingName })}</dt>
                  <dd>{money(order.shippingCents)}</dd>
                </>
              )}
              {order.taxCents > 0 && (
                <>
                  <dt>{order.taxIncluded ? t('order.taxIncluded') : t('order.tax')}</dt>
                  <dd>{money(order.taxCents)}</dd>
                </>
              )}
              <dt className="shop-total">{t('order.total')}</dt>
              <dd className="shop-total" data-testid="order-total">
                {money(order.totalCents)}
              </dd>
              {order.refundedCents > 0 && (
                <>
                  <dt>{t('order.refunded')}</dt>
                  <dd>−{money(order.refundedCents)}</dd>
                </>
              )}
            </dl>
            <div className="shop-actions-row">
              {canAdmin && (order.status === 'paid' || order.status === 'fulfilled') && remaining > 0 && (
                <button type="button" className="btn btn-secondary" onClick={() => setRefund({ amount: remaining, restock: order.status === 'paid', reason: '' })}>
                  {t('order.refund')}
                </button>
              )}
              {(order.status === 'pending' || order.status === 'paid') && (
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmCancel(true)}>
                  {t('order.cancel')}
                </button>
              )}
            </div>
          </section>

          <section className="panel shop-panel" aria-labelledby="ord-timeline">
            <h2 className="shop-panel-title" id="ord-timeline">
              {t('order.timeline')}
            </h2>
            <form className="shop-note-form" onSubmit={addNote}>
              <label className="sr-only" htmlFor="ord-note">
                {t('order.addNote')}
              </label>
              <input id="ord-note" className="input" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder={t('order.notePh')} />
              <button type="submit" className="btn btn-secondary" disabled={!note.trim() || busy}>
                {t('order.addNote')}
              </button>
            </form>
            <ol className="shop-timeline" data-testid="order-timeline">
              {[...(order.events ?? [])].reverse().map((ev) => (
                <li key={ev.id} data-kind={ev.kind}>
                  <span className="shop-timeline-kind">{t.has(`order.events.${ev.kind}`) ? t(`order.events.${ev.kind}`) : ev.kind}</span> {ev.message}{' '}
                  <span className="shop-rowmeta">{date(ev.createdAt)}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="shop-editor-side">
          <section className="panel shop-panel">
            <h2 className="shop-panel-title">{t('order.customer')}</h2>
            <p>
              {order.customerId ? <Link href={`/app/shop/customers/${order.customerId}`}>{order.name || order.email}</Link> : order.name || order.email}
            </p>
            <p className="shop-rowmeta">{order.email}</p>
            {order.phone && <p className="shop-rowmeta">{order.phone}</p>}
            {order.note && (
              <p className="shop-customer-note">
                <strong>{t('order.customerNote')}:</strong> {order.note}
              </p>
            )}
          </section>
          {a && (
            <section className="panel shop-panel">
              <h2 className="shop-panel-title">{t('order.shippingAddress')}</h2>
              <address className="shop-address">
                {a.name}
                <br />
                {a.line1}
                {a.line2 ? (
                  <>
                    <br />
                    {a.line2}
                  </>
                ) : null}
                <br />
                {[a.city, a.region, a.postalCode].filter(Boolean).join(', ')}
                <br />
                {a.country}
              </address>
            </section>
          )}
          {order.tracking.number && (
            <section className="panel shop-panel">
              <h2 className="shop-panel-title">{t('order.tracking')}</h2>
              <p>
                {order.tracking.company ? `${order.tracking.company} · ` : ''}
                {order.tracking.url ? (
                  <a href={order.tracking.url} target="_blank" rel="noreferrer noopener">
                    {order.tracking.number}
                  </a>
                ) : (
                  order.tracking.number
                )}
              </p>
            </section>
          )}
          <p className="ui-help">
            <a href={`/store/${storeHandle}`} target="_blank" rel="noreferrer">
              {t('order.viewStore')}
            </a>
          </p>
        </aside>
      </div>

      <ShopDialog open={!!fulfill} title={t('order.fulfillTitle', { n: order.number })} onClose={() => setFulfill(null)}>
        {fulfill && (
          <form onSubmit={doFulfill}>
            <div className="ui-modal-body">
              <label className="ui-field">
                <span className="label">{t('order.trackingNumber')}</span>
                <input className="input" autoFocus value={fulfill.number} maxLength={80} onChange={(e) => setFulfill({ ...fulfill, number: e.target.value })} />
              </label>
              <label className="ui-field">
                <span className="label">{t('order.carrier')}</span>
                <input className="input" value={fulfill.company} maxLength={80} placeholder="Correo Argentino, Andreani, UPS…" onChange={(e) => setFulfill({ ...fulfill, company: e.target.value })} />
              </label>
              <label className="ui-field">
                <span className="label">{t('order.trackingUrl')}</span>
                <input className="input" type="url" value={fulfill.url} onChange={(e) => setFulfill({ ...fulfill, url: e.target.value })} />
              </label>
              <label className="ui-check">
                <input type="checkbox" checked={fulfill.notify} onChange={(e) => setFulfill({ ...fulfill, notify: e.target.checked })} />
                <span>{t('order.notifyCustomer')}</span>
              </label>
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setFulfill(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" aria-busy={busy} disabled={busy}>
                {t('order.fulfillConfirm')}
              </button>
            </div>
          </form>
        )}
      </ShopDialog>

      <ShopDialog open={!!refund} title={t('order.refundTitle', { n: order.number })} onClose={() => setRefund(null)}>
        {refund && (
          <form onSubmit={doRefund}>
            <div className="ui-modal-body">
              <label className="ui-field">
                <span className="label">{t('order.refundAmount', { max: money(remaining) })}</span>
                <MoneyInput id="refund-amount" label={t('order.refundAmount', { max: money(remaining) })} value={refund.amount} onChange={(c) => setRefund({ ...refund, amount: c })} required />
              </label>
              <label className="ui-field">
                <span className="label">{t('order.reason')}</span>
                <input className="input" value={refund.reason} maxLength={200} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} />
              </label>
              <label className="ui-check">
                <input type="checkbox" checked={refund.restock} onChange={(e) => setRefund({ ...refund, restock: e.target.checked })} />
                <span>{t('order.restock')}</span>
              </label>
              <p className="ui-help">{order.paymentMethod === 'manual' ? t('order.refundManualHelp') : t('order.refundHelp')}</p>
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setRefund(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-danger" aria-busy={busy} disabled={busy || !refund.amount}>
                {t('order.refundConfirm')}
              </button>
            </div>
          </form>
        )}
      </ShopDialog>

      <ConfirmDialog
        open={confirmPaid}
        title={t('order.markPaidTitle', { n: order.number })}
        body={t('order.markPaidBody')}
        confirmLabel={t('order.markPaid')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        onConfirm={() => void act('mark-paid', {}, t('order.paidToast')).then(() => setConfirmPaid(false))}
        onCancel={() => setConfirmPaid(false)}
      />
      <ConfirmDialog
        open={confirmCancel}
        danger
        title={t('order.cancelTitle', { n: order.number })}
        body={order.status === 'paid' ? t('order.cancelPaidBody') : t('order.cancelBody')}
        confirmLabel={t('order.cancel')}
        cancelLabel={t('common.back')}
        busy={busy}
        onConfirm={() => void act('cancel', { restock: true }, t('order.cancelledToast')).then(() => setConfirmCancel(false))}
        onCancel={() => setConfirmCancel(false)}
      />
      {toast}
    </div>
  );
}
