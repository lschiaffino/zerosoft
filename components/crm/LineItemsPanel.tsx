'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { formatMoney } from '@/lib/crm-money';

export interface LineItemView {
  id: string;
  product_id: string | null;
  name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_pct: number;
  recurring: string;
  net: number;
  total: number;
  updated_at: string;
}

interface LineItemsPanelProps {
  dealId: string;
  currency: string;
  locale: string;
  items: LineItemView[];
  totals: { subtotal: number; discount: number; net: number; tax: number; total: number };
  amountOverride: boolean;
  dealAmount: number;
  products: Array<{ id: string; name: string; price: number; currency: string; recurring: string }>;
}

type NumField = 'quantity' | 'unit_price' | 'discount_pct' | 'tax_pct';

const API_FIELD: Record<NumField | 'name', string> = {
  name: 'name',
  quantity: 'quantity',
  unit_price: 'unitPrice',
  discount_pct: 'discountPct',
  tax_pct: 'taxPct',
};

/**
 * Line items del deal: tabla editable en línea (se guarda al salir del campo),
 * agregar desde el catálogo o una línea custom, totales y origen del amount.
 */
export default function LineItemsPanel({
  dealId,
  currency,
  locale,
  items,
  totals,
  amountOverride,
  dealAmount,
  products,
}: LineItemsPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState({ name: '', quantity: '1', price: '' });

  const money = (n: number) => formatMoney(n, currency, locale, true);
  const base = `/api/crm/deals/${dealId}/line-items`;

  async function call(url: string, method: string, body?: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      router.refresh();
      return true;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    setError(t.has(`errors.${code}`) ? t(`errors.${code}` as 'errors.generic') : t('errors.generic'));
    return false;
  }

  async function addProduct(productId: string) {
    if (productId) await call(base, 'POST', { productId });
  }

  async function addCustom() {
    if (!custom.name.trim()) return;
    const ok = await call(base, 'POST', {
      name: custom.name.trim(),
      quantity: Number(custom.quantity) > 0 ? Number(custom.quantity) : 1,
      unitPrice: Number(custom.price) || 0,
    });
    if (ok) {
      setCustom({ name: '', quantity: '1', price: '' });
      setAdding(false);
    }
  }

  function save(item: LineItemView, field: NumField | 'name', raw: string) {
    if (field === 'name') {
      const v = raw.trim();
      if (!v || v === item.name) return;
      void call(`${base}/${item.id}`, 'PATCH', { name: v });
      return;
    }
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n) || n === item[field]) return;
    if (field === 'quantity' && n <= 0) return;
    void call(`${base}/${item.id}`, 'PATCH', { [API_FIELD[field]]: n });
  }

  const fromItems = items.length > 0 && !amountOverride;

  return (
    <div className="li-panel">
      {items.length === 0 ? (
        <p className="muted li-empty">{t('lineItems.empty')}</p>
      ) : (
        <div className="li-table-wrap">
          <table className="li-table">
            <thead>
              <tr>
                <th>{t('lineItems.item')}</th>
                <th className="num">{t('lineItems.qty')}</th>
                <th className="num">{t('lineItems.unitPrice')}</th>
                <th className="num">{t('lineItems.discountPct')}</th>
                <th className="num">{t('lineItems.taxPct')}</th>
                <th className="num">{t('lineItems.amount')}</th>
                <th aria-label={t('common.actions')} />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.id}-${item.updated_at}`} className={busy ? 'li-busy' : undefined}>
                  <td>
                    <input
                      className="li-input li-name"
                      defaultValue={item.name}
                      aria-label={t('lineItems.item')}
                      maxLength={500}
                      onBlur={(e) => save(item, 'name', e.target.value)}
                    />
                    <span className="li-sub mono">
                      {[item.sku, item.recurring !== 'none' ? t(`enums.recurring.${item.recurring}`) : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </td>
                  {(['quantity', 'unit_price', 'discount_pct', 'tax_pct'] as const).map((f) => (
                    <td key={f} className="num">
                      <input
                        className="li-input li-num mono"
                        type="number"
                        min={f === 'quantity' ? 0.0001 : 0}
                        max={f === 'discount_pct' || f === 'tax_pct' ? 100 : undefined}
                        step="any"
                        inputMode="decimal"
                        defaultValue={item[f]}
                        aria-label={t(`lineItems.${f === 'quantity' ? 'qty' : f === 'unit_price' ? 'unitPrice' : f === 'discount_pct' ? 'discountPct' : 'taxPct'}`)}
                        onBlur={(e) => save(item, f, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                      />
                    </td>
                  ))}
                  <td className="num mono li-amount" title={`${t('lineItems.total')}: ${money(item.total)}`}>
                    {money(item.net)}
                  </td>
                  <td className="li-actions">
                    <button
                      type="button"
                      className="chip-remove"
                      aria-label={`${t('lineItems.remove')} ${item.name}`}
                      disabled={busy}
                      onClick={() => call(`${base}/${item.id}`, 'DELETE')}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && (
        <dl className="li-totals mono">
          <dt>{t('lineItems.subtotal')}</dt>
          <dd>{money(totals.subtotal)}</dd>
          {totals.discount > 0 && (
            <>
              <dt>{t('lineItems.discount')}</dt>
              <dd>−{money(totals.discount)}</dd>
            </>
          )}
          {totals.tax > 0 && (
            <>
              <dt>{t('lineItems.tax')}</dt>
              <dd>{money(totals.tax)}</dd>
            </>
          )}
          <dt className="li-grand">{t('lineItems.total')}</dt>
          <dd className="li-grand">{money(totals.total)}</dd>
        </dl>
      )}

      <div className="li-add">
        <select
          className="filter-select"
          value=""
          disabled={busy}
          aria-label={t('lineItems.addProduct')}
          onChange={(e) => {
            const v = e.target.value;
            e.target.value = '';
            void addProduct(v);
          }}
        >
          <option value="">{products.length ? t('lineItems.addProduct') : t('lineItems.noProducts')}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {formatMoney(p.price, p.currency, locale, true)}
              {p.recurring !== 'none' ? ` / ${t(`enums.recurring.${p.recurring}`)}` : ''}
            </option>
          ))}
        </select>
        {!adding ? (
          <button type="button" className="link-btn" onClick={() => setAdding(true)}>
            {t('lineItems.addCustom')}
          </button>
        ) : (
          <form
            className="li-custom"
            onSubmit={(e) => {
              e.preventDefault();
              void addCustom();
            }}
          >
            <input
              className="input"
              autoFocus
              value={custom.name}
              placeholder={t('lineItems.customName')}
              aria-label={t('lineItems.customName')}
              maxLength={500}
              onChange={(e) => setCustom((c) => ({ ...c, name: e.target.value }))}
            />
            <input
              className="input li-num mono"
              type="number"
              min={0.0001}
              step="any"
              value={custom.quantity}
              aria-label={t('lineItems.qty')}
              onChange={(e) => setCustom((c) => ({ ...c, quantity: e.target.value }))}
            />
            <input
              className="input li-num mono"
              type="number"
              min={0}
              step="any"
              value={custom.price}
              placeholder={t('lineItems.unitPrice')}
              aria-label={t('lineItems.unitPrice')}
              onChange={(e) => setCustom((c) => ({ ...c, price: e.target.value }))}
            />
            <button type="submit" className="btn btn-solid btn-small" disabled={busy || !custom.name.trim()}>
              {t('common.add')}
            </button>
            <button type="button" className="link-btn" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </button>
          </form>
        )}
        <Link href="/app/crm/products" className="link-btn li-catalog">
          {t('lineItems.catalog')}
        </Link>
      </div>

      {items.length > 0 && (
        <fieldset className="li-source" disabled={busy}>
          <legend className="mono">{t('lineItems.amountSource')}</legend>
          <label>
            <input
              type="radio"
              name={`li-source-${dealId}`}
              checked={fromItems}
              onChange={() => call(`/api/crm/deals/${dealId}`, 'PATCH', { amountOverride: false })}
            />
            {t('lineItems.fromItems', { amount: money(totals.net) })}
          </label>
          <label>
            <input
              type="radio"
              name={`li-source-${dealId}`}
              checked={!fromItems}
              onChange={() => call(`/api/crm/deals/${dealId}`, 'PATCH', { amountOverride: true })}
            />
            {t('lineItems.manual', { amount: money(dealAmount) })}
          </label>
        </fieldset>
      )}

      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
