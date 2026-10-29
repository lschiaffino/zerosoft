'use client';

import Link from 'next/link';
import { formatMoney } from '@/lib/shop-money';
import { fmt, type StorefrontStrings } from '@/lib/shop-i18n';
import { readCart, writeCart } from './cart-store';
import { usePricedCart } from './use-priced-cart';

/** Carrito: líneas con precio del servidor, cantidades y "ir a pagar". */
export default function CartView({ handle, locale, t }: { handle: string; locale: string; t: StorefrontStrings }) {
  const { lines, cart, error, loading } = usePricedCart(handle, {});
  const money = (c: number) => formatMoney(c, cart?.currency ?? 'USD', locale);
  const setQty = (variantId: string, quantity: number) => {
    const next = readCart(handle)
      .map((l) => (l.variantId === variantId ? { ...l, quantity } : l))
      .filter((l) => l.quantity > 0);
    writeCart(handle, next);
  };

  if (lines && lines.length === 0) {
    return (
      <section className="sf-section sf-empty">
        <h1 className="sf-h1">{t.cartTitle}</h1>
        <p>{t.cartEmpty}</p>
        <Link className="sf-btn sf-btn-primary" href={`/store/${handle}`}>
          {t.continueShopping}
        </Link>
      </section>
    );
  }
  return (
    <section className="sf-section">
      <h1 className="sf-h1">{t.cartTitle}</h1>
      {error && (
        <p className="sf-error" role="alert">
          {t.errors.generic}
        </p>
      )}
      {!cart && loading && <p className="sf-muted" role="status">{t.loading}</p>}
      {cart && (
        <div className="sf-cart">
          <ul className="sf-lines">
            {cart.lines.map((l) => (
              <li key={l.variantId} className="sf-line">
                <span className="sf-line-img">{l.imageUrl ? <img src={l.imageUrl} alt="" /> : <span className="sf-card-ph" aria-hidden="true" />}</span>
                <span className="sf-line-info">
                  <Link href={`/store/${handle}/products/${l.productHandle}`}>{l.title}</Link>
                  {l.variantTitle && <span className="sf-muted">{l.variantTitle}</span>}
                  <span className="sf-muted">{money(l.unitCents)}</span>
                  {l.short && <span className="sf-warn">{l.stock ? fmt(t.onlyLeft, { n: l.stock }) : t.soldOut}</span>}
                </span>
                <span className="sf-line-qty">
                  <label>
                    <span className="sf-sr">{t.quantity}</span>
                    <input type="number" min={0} max={999} value={l.quantity} onChange={(e) => setQty(l.variantId, Math.max(0, Math.min(999, Number(e.target.value) || 0)))} />
                  </label>
                  <button type="button" className="sf-link" onClick={() => setQty(l.variantId, 0)}>
                    {t.remove}
                  </button>
                </span>
                <span className="sf-line-total">{money(l.totalCents)}</span>
              </li>
            ))}
          </ul>
          {cart.removed.length > 0 && <p className="sf-warn">{t.itemsRemoved}</p>}
          <div className="sf-summary">
            <p className="sf-row">
              <span>{t.subtotal}</span>
              <strong data-testid="sf-subtotal">{money(cart.totals.subtotalCents)}</strong>
            </p>
            <p className="sf-muted">{t.shippingAtCheckout}</p>
            <Link
              className={`sf-btn sf-btn-primary sf-btn-block${cart.lines.some((l) => l.short) || !cart.lines.length ? ' is-disabled' : ''}`}
              href={`/store/${handle}/checkout`}
              aria-disabled={cart.lines.some((l) => l.short) || !cart.lines.length}
              onClick={(e) => {
                if (cart.lines.some((l) => l.short) || !cart.lines.length) e.preventDefault();
              }}
            >
              {t.checkout}
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
