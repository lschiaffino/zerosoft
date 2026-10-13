'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

const CURRENCIES = ['usd', 'eur', 'ars', 'brl', 'mxn', 'clp', 'cop', 'gbp'] as const;

interface Props {
  eventTypeId: string;
  priceCents: number;
  currency: string;
  paymentsConfigured: boolean;
}

/** Precio del tipo de evento: con precio > 0 el invitado paga con Stripe Checkout para confirmar. */
export default function EventPaymentPanel({ eventTypeId, priceCents, currency, paymentsConfigured }: Props) {
  const t = useTranslations('calendar');
  const [amount, setAmount] = useState(priceCents > 0 ? (priceCents / 100).toFixed(2) : '0');
  const [cur, setCur] = useState(currency || 'usd');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) {
      setError(t('errors.invalid_input'));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/calendar/event-types/${eventTypeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ priceCents: Math.round(value * 100), currency: cur }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) setSaved(true);
    else setError(t('errors.generic'));
  }

  const charging = Number(amount.replace(',', '.')) > 0;

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
        {t('payments.free')}
      </p>
      {charging && !paymentsConfigured ? (
        <p className="cal-warn">
          {t('payments.notConfigured')}{' '}
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
