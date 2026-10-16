'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { isZeroDecimal, minimumPriceCents, parsePriceInput, priceInputValue, priceProblem } from '@/lib/calendar-price';

const CURRENCIES = ['usd', 'eur', 'ars', 'brl', 'mxn', 'clp', 'cop', 'gbp'] as const;

interface Props {
  eventTypeId: string;
  priceCents: number;
  currency: string;
  paymentsConfigured: boolean;
  /** Clave y signing secret cargados: recién ahí los invitados pueden pagar. */
  paymentsReady: boolean;
}

/** Precio del tipo de evento: con precio > 0 el invitado paga con Stripe Checkout para confirmar. */
export default function EventPaymentPanel({ eventTypeId, priceCents, currency, paymentsConfigured, paymentsReady }: Props) {
  const t = useTranslations('calendar');
  const locale = useLocale();
  const [amount, setAmount] = useState(priceInputValue(priceCents, currency || 'usd'));
  const [cur, setCur] = useState(currency || 'usd');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const format = (cents: number) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: cur.toUpperCase() }).format(cents / 100);
    } catch {
      return `${cur.toUpperCase()} ${cents / 100}`;
    }
  };

  /** Mensaje de error del monto escrito, o null si se puede cobrar. */
  function amountError(cents: number | null): string | null {
    if (cents === null) {
      return isZeroDecimal(cur) && parsePriceInput(amount, 'usd') !== null
        ? t('payments.noCents', { currency: cur.toUpperCase() })
        : t('payments.invalidAmount');
    }
    const problem = priceProblem(cents, cur);
    if (problem === 'zero_decimal') return t('payments.noCents', { currency: cur.toUpperCase() });
    if (problem === 'below_minimum') return t('payments.belowMinimum', { min: format(minimumPriceCents(cur)) });
    return null;
  }

  async function save() {
    const cents = parsePriceInput(amount, cur);
    const invalid = amountError(cents);
    if (invalid || cents === null) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/calendar/event-types/${eventTypeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ priceCents: cents, currency: cur }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) setSaved(true);
    else setError(t('errors.generic'));
  }

  const parsed = parsePriceInput(amount, cur);
  const charging = parsed !== null && parsed > 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <p className="section-label">{t('payments.title')}</p>
        <button type="button" className="btn btn-solid btn-small" onClick={save} disabled={busy}>
          {busy ? t('common.saving') : saved ? t('common.saved') : t('common.save')}
        </button>
      </div>
      <div className="cal-pay-row">
        <label className="field">
          <span className="prop-label">{t('payments.price')}</span>
          <input
            className="input mono"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setSaved(false);
            }}
            aria-describedby="cal-pay-free"
          />
        </label>
        <label className="field">
          <span className="prop-label">{t('payments.currency')}</span>
          <select
            className="select"
            value={cur}
            onChange={(e) => {
              setCur(e.target.value);
              setSaved(false);
            }}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p id="cal-pay-free" className="muted mono cal-sched-hint">
        {charging ? t('payments.charges', { amount: format(parsed) }) : t('payments.free')}
      </p>
      {charging && !paymentsReady ? (
        <p className="cal-warn">
          {t(paymentsConfigured ? 'payments.eventWebhookMissing' : 'payments.notConfigured')}{' '}
          <Link href="/app/calendar/settings" className="mono">
            {t('sidebar.settings')} →
          </Link>
        </p>
      ) : charging ? (
        <p className="muted cal-sched-hint">{t('payments.hint')}</p>
      ) : null}
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
