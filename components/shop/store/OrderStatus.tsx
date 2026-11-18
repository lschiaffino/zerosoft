'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatMoney } from '@/lib/shop-money';
import { fmt, type StorefrontStrings } from '@/lib/shop-i18n';
import type { PublicOrder } from '@/lib/shop-orders';

/**
 * Página del pedido (link del email y regreso del pago). Mientras está
 * pendiente de un pago online, vuelve a preguntar unos segundos: el webhook
 * del proveedor puede llegar después que el cliente.
 */
export default function OrderStatus({ handle, token, locale, t }: { handle: string; token: string; locale: string; t: StorefrontStrings }) {
  const sp = useSearchParams();
  const session = sp.get('session_id');
  const returning = sp.get('return') === '1';
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [error, setError] = useState<'not_found' | 'generic' | null>(null);
  const [tries, setTries] = useState(0);
  const [paying, setPaying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ret, setRet] = useState<{ qty: Record<string, number>; reason: string; note: string } | null>(null);
  const [retSent, setRetSent] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ token });
      if (session) q.set('session_id', session);
      const res = await fetch(`/api/shop/public/${handle}/order?${q}`, { cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as { order?: PublicOrder };
      if (res.status === 404) setError('not_found');
      else if (!res.ok || !data.order) setError('generic');
      else {
        setError(null);
        setOrder(data.order);
      }
    } catch {
      setError('generic');
    }
  }, [handle, token, session]);

  useEffect(() => {
    void load();
  }, [load]);

  // Volviendo del pago: hasta ~30 s de reintentos mientras sigue pendiente.
  useEffect(() => {
    if (!order || order.status !== 'pending' || order.paymentMethod === 'manual' || !returning || tries >= 15) return;
    const id = window.setTimeout(() => {
      setTries((n) => n + 1);
      void load();
    }, 2000);
    return () => window.clearTimeout(id);
  }, [order, returning, tries, load]);

  if (error === 'not_found') {
    return (
      <section className="sf-section sf-narrow">
        <h1 className="sf-h1">{t.orderNotFound}</h1>
      </section>
    );
  }
  if (!order) {
    return (
      <section className="sf-section sf-narrow">
        <p className="sf-muted" role="status">
          {error ? t.errors.generic : t.loading}
        </p>
      </section>
    );
  }
  const money = (c: number) => formatMoney(c, order.currency, locale);
  const errText = (c: string) => (t.errors as Record<string, string>)[c] ?? t.errors.generic;
  const pay = async (method: string) => {
    setPaying(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/shop/public/${handle}/order/pay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, method }) });
      const data = (await res.json().catch(() => ({}))) as { redirectUrl?: string; error?: string };
      if (res.ok && data.redirectUrl) return window.location.assign(data.redirectUrl);
      setActionError(data.error ?? 'generic');
    } catch {
      setActionError('network');
    }
    setPaying(false);
  };
  const sendReturn = async (e: FormEvent) => {
    e.preventDefault();
    if (!ret) return;
    const items = Object.entries(ret.qty).filter(([, q]) => q > 0).map(([itemId, quantity]) => ({ itemId, quantity }));
    if (!items.length) return setActionError('invalid_input');
    setActionError(null);
    try {
      const res = await fetch(`/api/shop/public/${handle}/order/return`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, items, reason: ret.reason, note: ret.note }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setActionError(data.error ?? 'generic');
      setRet(null);
      setRetSent(true);
      void load();
    } catch {
      setActionError('network');
    }
  };
  const label = (t.status as Record<string, string>)[order.status] ?? order.status;
  return (
    <section className="sf-section sf-narrow">
      <p className="sf-muted">{fmt(t.orderN, { n: order.number })}</p>
      <h1 className="sf-h1">{order.status === 'pending' && order.paymentMethod !== 'manual' ? t.paymentProcessing : order.status === 'pending' ? t.thanksPending : t.thanks}</h1>
      <p className="sf-status" data-testid="sf-order-status" data-status={order.status}>
        {label}
      </p>
      {order.instructions && (
        <div className="sf-panel">
          <h2 className="sf-h2">{t.transferTitle}</h2>
          <p className="sf-pre">{order.instructions}</p>
          <p className="sf-muted">{fmt(t.transferRef, { n: order.number })}</p>
        </div>
      )}
      {order.payMethods.length > 0 && (
        <div className="sf-panel" data-testid="sf-pay">
          <h2 className="sf-h2">{t.payNow}</h2>
          <div className="sf-actions">
            {order.payMethods.map((m) => (
              <button key={m} type="button" className="sf-btn sf-btn-primary" disabled={paying} onClick={() => void pay(m)}>
                {m === 'stripe' ? t.methodCard : t.methodMp}
              </button>
            ))}
          </div>
        </div>
      )}
      {order.pickup && (
        <div className="sf-panel">
          <h2 className="sf-h2">{t.pickup}</h2>
          <p className="sf-pre">{order.pickupNote || order.shippingName}</p>
        </div>
      )}
      {order.fulfillment === 'partial' && <p className="sf-status" data-testid="sf-partial">{t.partlyShipped}</p>}
      {order.shipments.some((s) => s.number) ? (
        <div className="sf-panel">
          <h2 className="sf-h2">{t.tracking}</h2>
          {order.shipments.filter((s) => s.number).map((s, i) => (
            <p key={i}>
              {s.company ? `${s.company} · ` : ''}
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer noopener">
                  {s.number}
                </a>
              ) : (
                s.number
              )}
              {order.shipments.length > 1 && <span className="sf-muted sf-block">{s.items.map((x) => `${x.title} × ${x.quantity}`).join(', ')}</span>}
            </p>
          ))}
        </div>
      ) : (
        order.tracking.number && (
          <div className="sf-panel">
            <h2 className="sf-h2">{t.tracking}</h2>
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
          </div>
        )
      )}
      {actionError && <p className="sf-error" role="alert">{errText(actionError)}</p>}
      <ul className="sf-lines sf-lines-compact">
        {order.items.map((i, n) => (
          <li key={n} className="sf-line">
            <span className="sf-line-img">{i.imageUrl ? <img src={i.imageUrl} alt="" /> : <span className="sf-card-ph" aria-hidden="true" />}</span>
            <span className="sf-line-info">
              <span>{i.title}</span>
              {i.variantTitle && <span className="sf-muted">{i.variantTitle}</span>}
              <span className="sf-muted">× {i.quantity}</span>
            </span>
            <span className="sf-line-total">{money(i.totalCents)}</span>
          </li>
        ))}
      </ul>
      <div className="sf-summary">
        <p className="sf-row">
          <span>{t.subtotal}</span>
          <span>{money(order.subtotalCents)}</span>
        </p>
        {order.discountCents > 0 && (
          <p className="sf-row">
            <span>
              {t.discount} ({order.discountCode})
            </span>
            <span>−{money(order.discountCents)}</span>
          </p>
        )}
        {order.shippingName && (
          <p className="sf-row">
            <span>
              {t.shipping} ({order.shippingName})
            </span>
            <span>{order.shippingCents === 0 ? t.free : money(order.shippingCents)}</span>
          </p>
        )}
        {order.taxCents > 0 && (
          <p className="sf-row">
            <span>{order.taxIncluded ? fmt(t.taxIncluded, { name: t.tax }) : t.tax}</span>
            <span>{money(order.taxCents)}</span>
          </p>
        )}
        <p className="sf-row sf-total">
          <span>{t.total}</span>
          <strong>{money(order.totalCents)}</strong>
        </p>
      </div>
      {(retSent || order.returnRequested) && <p className="sf-status" data-testid="sf-return-sent">{t.returnRequested}</p>}
      {order.returnable.length > 0 && !ret && (
        <p>
          <button type="button" className="sf-btn" onClick={() => setRet({ reason: 'other', note: '', qty: Object.fromEntries(order.returnable.map((i) => [i.itemId, i.quantity])) })}>
            {t.requestReturn}
          </button>
        </p>
      )}
      {ret && (
        <form className="sf-panel" onSubmit={sendReturn} data-testid="sf-return-form">
          <h2 className="sf-h2">{t.requestReturn}</h2>
          {order.returnable.map((i) => (
            <label key={i.itemId} className="sf-field">
              <span>{i.title}{i.variantTitle ? ` (${i.variantTitle})` : ''}</span>
              <input type="number" min={0} max={i.quantity} value={ret.qty[i.itemId] ?? 0} onChange={(e) => setRet({ ...ret, qty: { ...ret.qty, [i.itemId]: Math.max(0, Math.min(i.quantity, Number(e.target.value) || 0)) } })} />
            </label>
          ))}
          <label className="sf-field">
            <span>{t.returnReason}</span>
            <select value={ret.reason} onChange={(e) => setRet({ ...ret, reason: e.target.value })}>
              {Object.entries(t.returnReasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="sf-field">
            <span>{t.note} {t.optional}</span>
            <textarea rows={2} maxLength={500} value={ret.note} onChange={(e) => setRet({ ...ret, note: e.target.value })} />
          </label>
          <div className="sf-actions">
            <button type="submit" className="sf-btn sf-btn-primary">{t.sendReturn}</button>
            <button type="button" className="sf-btn" onClick={() => setRet(null)}>{t.cancel}</button>
          </div>
        </form>
      )}
      <p className="sf-muted">{fmt(t.sentTo, { email: order.email })}</p>
    </section>
  );
}
