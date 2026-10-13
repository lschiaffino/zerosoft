'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import { COMMON_CURRENCIES, RECURRING_INTERVALS } from '@/lib/crm-constants';

export interface ProductFormValue {
  id?: string;
  name: string;
  sku: string;
  description: string;
  price: number;
  currency: string;
  recurring: string;
  tax_pct: number;
  active: number;
}

interface ProductModalProps {
  /** Producto a editar; sin él, el modal crea uno nuevo. */
  product?: ProductFormValue | null;
  defaultCurrency: string;
  onClose: () => void;
}

const KNOWN_ERRORS = new Set(['missing_name', 'invalid_input', 'rate_limited']);

/** Alta/edición de producto del catálogo en un QuickModal. */
export function ProductModal({ product, defaultCurrency, onClose }: ProductModalProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const editing = !!product?.id;
  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [price, setPrice] = useState(product ? String(product.price) : '');
  const [currency, setCurrency] = useState(product?.currency ?? defaultCurrency);
  const [recurring, setRecurring] = useState(product?.recurring ?? 'none');
  const [taxPct, setTaxPct] = useState(product ? String(product.tax_pct) : '');
  const [active, setActive] = useState(product ? !!product.active : true);
  const [createMore, setCreateMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currencies = [...new Set([currency, defaultCurrency, ...COMMON_CURRENCIES])];

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      sku: sku.trim(),
      description,
      price: price ? Number(price) : 0,
      currency,
      recurring,
      taxPct: taxPct ? Number(taxPct) : 0,
      active,
    };
    const res = await fetch(editing ? `/api/crm/products/${product!.id}` : '/api/crm/products', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) {
      router.refresh();
      if (!editing && createMore) {
        setName('');
        setSku('');
        setDescription('');
        setPrice('');
        document.querySelector<HTMLInputElement>('.qm [data-autofocus]')?.focus();
      } else {
        onClose();
      }
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    setError(t(KNOWN_ERRORS.has(code) ? `errors.${code}` : 'errors.generic'));
  }

  return (
    <QuickModal
      open
      onClose={onClose}
      crumb={`CRM › ${editing ? t('products.editTitle') : t('products.newTitle')}`}
      onSubmit={submit}
      submitLabel={busy ? t('common.saving') : editing ? t('common.save') : t('common.create')}
      cancelLabel={t('common.cancel')}
      submitDisabled={!name.trim()}
      busy={busy}
      error={error}
      hint={t('quick.hint')}
      footExtra={
        editing ? (
          <label className="qm-check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t('products.active')}
          </label>
        ) : (
          <label className="qm-check">
            <input type="checkbox" checked={createMore} onChange={(e) => setCreateMore(e.target.checked)} />
            {t('quick.createMore')}
          </label>
        )
      }
    >
      <input
        data-autofocus
        className="qm-title"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('products.form.name')}
        aria-label={t('products.form.name')}
        maxLength={200}
      />
      <div className="qm-row">
        <label className="qm-field">
          <span>{t('products.form.price')}</span>
          <input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <label className="qm-field">
          <span>{t('products.form.currency')}</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="qm-row">
        <label className="qm-field">
          <span>{t('products.form.recurring')}</span>
          <select value={recurring} onChange={(e) => setRecurring(e.target.value)}>
            {RECURRING_INTERVALS.map((r) => (
              <option key={r} value={r}>
                {t(`enums.recurring.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="qm-field">
          <span>{t('products.form.taxPct')}</span>
          <input
            type="number"
            min={0}
            max={100}
            step="any"
            inputMode="decimal"
            value={taxPct}
            onChange={(e) => setTaxPct(e.target.value)}
          />
        </label>
        <label className="qm-field">
          <span>{t('products.form.sku')}</span>
          <input value={sku} onChange={(e) => setSku(e.target.value)} maxLength={100} />
        </label>
      </div>
      <label className="qm-field">
        <span>{t('products.form.description')}</span>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
      </label>
    </QuickModal>
  );
}

/** CTA "New product" del catálogo: tecla C y `?new=1` abren el modal. */
export default function ProductQuickCreate({ defaultCurrency }: { defaultCurrency: string }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setOpen(true);
      const params = new URLSearchParams(searchParams.toString());
      params.delete('new');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [searchParams, pathname, router]);

  useKeyShortcut('c', () => setOpen(true), !open);

  return (
    <>
      <button
        type="button"
        className="btn btn-solid btn-small"
        onClick={() => setOpen(true)}
        data-testid="crm-quick-product"
      >
        {t('products.new')}
        <span className="kbd-hint" aria-hidden>
          C
        </span>
      </button>
      {open && <ProductModal defaultCurrency={defaultCurrency} onClose={() => setOpen(false)} />}
    </>
  );
}
