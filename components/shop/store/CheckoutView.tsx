'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { formatMoney } from '@/lib/shop-money';
import { fmt, type StorefrontStrings } from '@/lib/shop-i18n';
import { clearCart } from './cart-store';
import { usePricedCart } from './use-priced-cart';

export const COUNTRIES = [
  'AR', 'BO', 'BR', 'CL', 'CO', 'CR', 'DO', 'EC', 'GT', 'HN', 'MX', 'NI', 'PA', 'PE', 'PR', 'PY', 'SV', 'UY', 'VE',
  'US', 'CA', 'ES', 'PT', 'GB', 'DE', 'FR', 'IT', 'NL', 'IE', 'AU', 'NZ', 'JP',
];

type Method = 'stripe' | 'mercadopago' | 'manual';

/** Checkout como invitado: email, envío, código, método de pago. Todo lo cobrado lo calcula el servidor. */
export default function CheckoutView({
  handle,
  locale,
  t,
  manualLabel,
}: {
  handle: string;
  locale: string;
  t: StorefrontStrings;
  manualLabel: string;
}) {
  const [email, setEmail] = useState('');
  const [addr, setAddr] = useState({ name: '', line1: '', line2: '', city: '', region: '', postalCode: '', country: '', phone: '' });
  const [rateId, setRateId] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const priceOpts = useMemo(
    () => ({ address: addr.country ? { country: addr.country, region: addr.region } : null, shippingRateId: rateId, discountCode: code }),
    [addr.country, addr.region, rateId, code],
  );
  const { lines, cart, methods, error, loading } = usePricedCart(handle, priceOpts);
  const money = (c: number) => formatMoney(c, cart?.currency ?? 'USD', locale);
  const regionNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      return null;
    }
  }, [locale]);
  const chosen: Method | null = method && methods.includes(method) ? method : ((methods[0] as Method | undefined) ?? null);
  const needsShipping = cart?.totals.needsShipping ?? true;
  const errText = (c: string) => (t.errors as Record<string, string>)[c] ?? t.errors.generic;

  if (lines && lines.length === 0) {
    return (
      <section className="sf-section sf-empty">
        <h1 className="sf-h1">{t.checkoutTitle}</h1>
        <p>{t.cartEmpty}</p>
        <Link className="sf-btn sf-btn-primary" href={`/store/${handle}`}>
          {t.continueShopping}
        </Link>
      </section>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!lines || !chosen || busy) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/shop/public/${handle}/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          lines,
          address: needsShipping ? addr : null,
          shippingRateId: cart?.totals.shipping?.id ?? null,
          discountCode: code,
          paymentMethod: chosen,
          note,
          website: (document.getElementById('sf-website') as HTMLInputElement | null)?.value || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { redirectUrl?: string; error?: string };
      if (!res.ok || !data.redirectUrl) {
        setSubmitError(data.error ?? 'generic');
        setBusy(false);
        return;
      }
      clearCart(handle);
      window.location.assign(data.redirectUrl);
    } catch {
      setSubmitError('network');
      setBusy(false);
    }
  };

  const field = (k: keyof typeof addr, label: string, opts: { required?: boolean; autoComplete?: string; type?: string } = {}) => (
    <label className="sf-field">
      <span>
        {label}
        {opts.required ? '' : ` ${t.optional}`}
      </span>
      <input
        type={opts.type ?? 'text'}
        value={addr[k]}
        required={opts.required}
        autoComplete={opts.autoComplete}
        onChange={(e) => setAddr({ ...addr, [k]: e.target.value })}
      />
    </label>
  );

  return (
    <section className="sf-section">
      <h1 className="sf-h1">{t.checkoutTitle}</h1>
      <form className="sf-checkout" onSubmit={submit} noValidate={false}>
        <div className="sf-checkout-form">
          <fieldset className="sf-fieldset">
            <legend>{t.contact}</legend>
            <label className="sf-field">
              <span>{t.email}</span>
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <p className="sf-muted">{t.guestNote}</p>
          </fieldset>
          {needsShipping && (
            <fieldset className="sf-fieldset">
              <legend>{t.shippingAddress}</legend>
              {field('name', t.fullName, { required: true, autoComplete: 'name' })}
              <label className="sf-field">
                <span>{t.country}</span>
                <select required value={addr.country} onChange={(e) => setAddr({ ...addr, country: e.target.value })} autoComplete="country">
                  <option value="">{t.chooseCountry}</option>
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {regionNames?.of(c) ?? c}
                    </option>
                  ))}
                </select>
              </label>
              {field('line1', t.address1, { required: true, autoComplete: 'address-line1' })}
              {field('line2', t.address2, { autoComplete: 'address-line2' })}
              <div className="sf-field-row">
                {field('city', t.city, { required: true, autoComplete: 'address-level2' })}
                {field('region', t.region, { autoComplete: 'address-level1' })}
                {field('postalCode', t.postalCode, { autoComplete: 'postal-code' })}
              </div>
              {field('phone', t.phone, { autoComplete: 'tel', type: 'tel' })}
            </fieldset>
          )}
          {needsShipping && (
            <fieldset className="sf-fieldset">
              <legend>{t.shippingMethod}</legend>
              {!addr.country && <p className="sf-muted">{t.chooseCountryFirst}</p>}
              {addr.country && cart && cart.totals.shippingOptions.length === 0 && <p className="sf-warn">{t.errors.no_shipping_rate}</p>}
              {cart?.totals.shippingOptions.map((o) => (
                <label key={o.id} className="sf-radio">
                  <input type="radio" name="rate" checked={cart.totals.shipping?.id === o.id} onChange={() => setRateId(o.id)} />
                  <span>{o.name}</span>
                  <strong>{o.priceCents === 0 ? t.free : money(o.priceCents)}</strong>
                </label>
              ))}
            </fieldset>
          )}
          <fieldset className="sf-fieldset">
            <legend>{t.payment}</legend>
            {methods.length === 0 && !loading && <p className="sf-warn">{t.errors.payment_unavailable}</p>}
            {methods.map((m) => (
              <label key={m} className="sf-radio">
                <input type="radio" name="method" checked={chosen === m} onChange={() => setMethod(m as Method)} />
                <span>{m === 'stripe' ? t.methodCard : m === 'mercadopago' ? t.methodMp : manualLabel || t.methodManual}</span>
              </label>
            ))}
          </fieldset>
          <label className="sf-field">
            <span>
              {t.note} {t.optional}
            </span>
            <textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {/* Campo trampa para bots: oculto a las personas. */}
          <input id="sf-website" name="website" tabIndex={-1} autoComplete="off" className="sf-hp" aria-hidden="true" />
        </div>
        <aside className="sf-summary sf-checkout-summary" aria-label={t.summary}>
          {cart?.lines.map((l) => (
            <p key={l.variantId} className="sf-row">
              <span>
                {l.title}
                {l.variantTitle ? ` (${l.variantTitle})` : ''} × {l.quantity}
                {l.short && <span className="sf-warn"> {l.stock ? fmt(t.onlyLeft, { n: l.stock }) : t.soldOut}</span>}
              </span>
              <span>{money(l.totalCents)}</span>
            </p>
          ))}
          <div className="sf-code">
            <label className="sf-field">
              <span>{t.discountCode}</span>
              <input value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} />
            </label>
            <button type="button" className="sf-btn" onClick={() => setCode(codeInput.trim() || null)} disabled={!codeInput.trim()}>
              {t.apply}
            </button>
          </div>
          {cart?.discount?.error && (
            <p className="sf-warn" role="alert">
              {errText(cart.discount.error)}
            </p>
          )}
          {cart && (
            <>
              <p className="sf-row">
                <span>{t.subtotal}</span>
                <span>{money(cart.totals.subtotalCents)}</span>
              </p>
              {cart.totals.discountCents > 0 && (
                <p className="sf-row" data-testid="sf-discount">
                  <span>
                    {t.discount} ({cart.discount?.code})
                  </span>
                  <span>−{money(cart.totals.discountCents)}</span>
                </p>
              )}
              {needsShipping && (
                <p className="sf-row">
                  <span>{t.shipping}</span>
                  <span>{cart.totals.shipping ? (cart.totals.shippingCents === 0 ? t.free : money(cart.totals.shippingCents)) : t.shippingPending}</span>
                </p>
              )}
              {cart.totals.taxCents > 0 && (
                <p className="sf-row">
                  <span>{cart.totals.taxIncluded ? fmt(t.taxIncluded, { name: cart.totals.taxName ?? t.tax }) : (cart.totals.taxName ?? t.tax)}</span>
                  <span>{money(cart.totals.taxCents)}</span>
                </p>
              )}
              <p className="sf-row sf-total">
                <span>{t.total}</span>
                <strong data-testid="sf-total">{money(cart.totals.totalCents)}</strong>
              </p>
            </>
          )}
          {(error || submitError) && (
            <p className="sf-error" role="alert">
              {errText(submitError ?? error ?? 'generic')}
            </p>
          )}
          <button type="submit" className="sf-btn sf-btn-primary sf-btn-block" disabled={busy || !chosen || !cart || cart.lines.some((l) => l.short)}>
            {busy ? t.placing : t.placeOrder}
          </button>
        </aside>
      </form>
    </section>
  );
}
