'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { COMMON_CURRENCIES } from '@/lib/crm-constants';
import { parseDbUtc } from '@/lib/utils';

interface Rate {
  currency: string;
  rate: number;
  updated_at: string;
}

interface CurrencySettingsProps {
  baseCurrency: string;
  rates: Rate[];
  /** Monedas usadas por deals que no tienen tipo de cambio. */
  missing: string[];
  canEdit: boolean;
  locale: string;
}

/**
 * Ajustes › Ventas › Moneda: moneda base del workspace y tipos de cambio
 * manuales (1 <moneda> = X <base>). Cada cambio se guarda al momento.
 */
export default function CurrencySettings({
  baseCurrency,
  rates: initialRates,
  missing,
  canEdit,
  locale,
}: CurrencySettingsProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [base, setBase] = useState(baseCurrency);
  const [rates, setRates] = useState<Rate[]>(initialRates);
  const [newCur, setNewCur] = useState(missing[0] ?? '');
  const [newRate, setNewRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const baseOptions = [...new Set([base, ...COMMON_CURRENCIES])];

  function fail(code?: string) {
    setError(code && t.has(`errors.${code}`) ? t(`errors.${code}` as 'errors.generic') : t('errors.generic'));
  }

  async function saveSettings(body: { baseCurrency: string }) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch('/api/crm/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    const data = (await res?.json().catch(() => null)) as { baseCurrency?: string; error?: string } | null;
    if (!res?.ok) return fail(data?.error);
    setRates((prev) => prev.filter((r) => r.currency !== body.baseCurrency));
    setSaved(true);
    router.refresh();
  }

  async function putRate(currency: string, rate: number) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/exchange-rates', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currency, rate }),
    }).catch(() => null);
    setBusy(false);
    const data = (await res?.json().catch(() => null)) as (Rate & { error?: string }) | null;
    if (!res?.ok || !data) return fail(data?.error);
    setRates((prev) =>
      [...prev.filter((r) => r.currency !== data.currency), data].sort((a, b) => a.currency.localeCompare(b.currency)),
    );
    router.refresh();
    return true;
  }

  async function removeRate(currency: string) {
    setBusy(true);
    const res = await fetch(`/api/crm/exchange-rates?currency=${encodeURIComponent(currency)}`, {
      method: 'DELETE',
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return fail();
    setRates((prev) => prev.filter((r) => r.currency !== currency));
    router.refresh();
  }

  async function addRate(e: React.FormEvent) {
    e.preventDefault();
    const cur = newCur.trim().toUpperCase();
    const n = Number(newRate.replace(',', '.'));
    if (!/^[A-Z]{3}$/.test(cur)) return fail('invalid_currency');
    if (!Number.isFinite(n) || n <= 0) return fail('invalid_rate');
    if (cur === base) return fail('invalid_currency');
    if (await putRate(cur, n)) {
      setNewCur('');
      setNewRate('');
    }
  }

  const fmtDate = (s: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parseDbUtc(s));

  return (
    <div className="currency-settings">
      <div className="ui-field currency-base">
        <label className="label" htmlFor="crm-base-currency">
          {t('currency.base')}
        </label>
        <select
          id="crm-base-currency"
          className="select"
          value={base}
          disabled={!canEdit || busy}
          onChange={(e) => {
            setBase(e.target.value);
            void saveSettings({ baseCurrency: e.target.value });
          }}
        >
          {baseOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="ui-help">{t('currency.baseHint')}</span>
      </div>

      <div className="currency-rates">
        <h3 className="label">{t('currency.rates')}</h3>
        <p className="ui-help">{t('currency.ratesHint', { base })}</p>
        {missing.length > 0 && <p className="ui-help currency-missing">{t('currency.missing', { list: missing.join(', ') })}</p>}
        {rates.length > 0 && (
          <div className="table-wrap">
          <table className="table table-compact currency-table">
            <thead>
              <tr>
                <th>{t('currency.currency')}</th>
                <th>{t('currency.rateTo', { base })}</th>
                <th>{t('currency.updated')}</th>
                <th scope="col">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.currency}>
                  <td className="data">1 {r.currency} =</td>
                  <td>
                    <input
                      className="input data currency-rate-input"
                      type="number"
                      step="any"
                      min="0"
                      defaultValue={r.rate}
                      disabled={!canEdit || busy}
                      aria-label={t('currency.rateTo', { base })}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n > 0 && n !== r.rate) void putRate(r.currency, n);
                      }}
                    />{' '}
                    <span className="data">{base}</span>
                  </td>
                  <td className="data">{fmtDate(r.updated_at)}</td>
                  <td>
                    {canEdit && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-danger btn-sm"
                        aria-label={`${t('currency.remove')} ${r.currency}`}
                        onClick={() => removeRate(r.currency)}
                      >
                        {t('currency.removeShort')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {canEdit && (
          <form className="currency-add" onSubmit={addRate}>
            <input
              className="input data currency-code"
              value={newCur}
              maxLength={3}
              placeholder="EUR"
              aria-label={t('currency.currency')}
              list="crm-currency-list"
              onChange={(e) => setNewCur(e.target.value.toUpperCase())}
            />
            <datalist id="crm-currency-list">
              {COMMON_CURRENCIES.filter((c) => c !== base).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <span className="data">=</span>
            <input
              className="input data currency-rate-input"
              value={newRate}
              inputMode="decimal"
              placeholder="1.08"
              aria-label={t('currency.rateTo', { base })}
              onChange={(e) => setNewRate(e.target.value)}
            />
            <span className="data">{base}</span>
            <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !newCur || !newRate}>
              {t('currency.addRate')}
            </button>
          </form>
        )}
      </div>

      {!canEdit && <p className="ui-help">{t('common.adminOnly')}</p>}
      <p className={error ? 'ui-error' : 'ui-help'} role="status" aria-live="polite">
        {error ?? (saved ? t('currency.saved') : null)}
      </p>
    </div>
  );
}
