'use client';

import { useCallback, useEffect, useState } from 'react';
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
      {order.tracking.number && (
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
      )}
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
      <p className="sf-muted">{fmt(t.sentTo, { email: order.email })}</p>
    </section>
  );
}
