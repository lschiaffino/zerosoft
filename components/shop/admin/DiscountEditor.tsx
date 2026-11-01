'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { DiscountDto } from '@/lib/shop';
import { MoneyInput, api, useErrorText, useToast } from './shop-ui';

/** "2026-11-01 03:00:00" (UTC) → valor de <input type="datetime-local"> en la hora local. */
function toLocalInput(v: string | null): string {
  if (!v) return '';
  const d = new Date(`${v.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Código de descuento: porcentaje, monto fijo o envío gratis; mínimo, tope de usos y vigencia. */
export default function DiscountEditor({ discount, currency, products = [], collections = [] }: { discount: DiscountDto | null; currency: string; products?: Array<{ id: string; title: string }>; collections?: Array<{ id: string; title: string }> }) {
  const t = useTranslations('shop');
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const isNew = !discount;
  const [code, setCode] = useState(discount?.code ?? '');
  const [kind, setKind] = useState<DiscountDto['kind']>(discount?.kind ?? 'percent');
  const [percent, setPercent] = useState(discount?.kind === 'percent' ? String(discount.value / 100) : '10');
  const [fixed, setFixed] = useState<number | null>(discount?.kind === 'fixed' ? discount.value : null);
  const [minOrder, setMinOrder] = useState<number | null>(discount?.minOrderCents ? discount.minOrderCents : null);
  const [limit, setLimit] = useState(discount?.usageLimit != null ? String(discount.usageLimit) : '');
  const [startsAt, setStartsAt] = useState(toLocalInput(discount?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(discount?.endsAt ?? null));
  const [active, setActive] = useState(discount?.active ?? true);
  const [method, setMethod] = useState<'code' | 'automatic'>(discount?.method ?? 'code');
  const [title, setTitle] = useState(discount?.title ?? '');
  const [minQty, setMinQty] = useState(discount?.minQuantity ? String(discount.minQuantity) : '');
  const [buy, setBuy] = useState(String(discount?.buyQuantity || 2));
  const [get, setGet] = useState(String(discount?.getQuantity || 1));
  const [getPercent, setGetPercent] = useState(discount?.kind === 'bxgy' ? String(discount.value / 100) : '100');
  const [once, setOnce] = useState(discount?.oncePerCustomer ?? false);
  const [scopeProducts, setScopeProducts] = useState<string[]>(discount?.scope?.productIds ?? []);
  const [scopeCollections, setScopeCollections] = useState<string[]>(discount?.scope?.collectionIds ?? []);
  const [scoped, setScoped] = useState(Boolean(discount?.scope?.productIds?.length || discount?.scope?.collectionIds?.length));
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const pct = Math.round(Number(percent.replace(',', '.')) * 100);
    const body = {
      // Un automático no se escribe: su código es un identificador interno.
      code: method === 'automatic' ? code.trim().toUpperCase() || `AUTO-${Date.now().toString(36).toUpperCase()}` : code.trim().toUpperCase(),
      method,
      title: method === 'automatic' ? title.trim() : '',
      minQuantity: Number(minQty) || 0,
      buyQuantity: kind === 'bxgy' ? Number(buy) || 0 : 0,
      getQuantity: kind === 'bxgy' ? Number(get) || 0 : 0,
      oncePerCustomer: once,
      scope: scoped ? { productIds: scopeProducts, collectionIds: scopeCollections } : { productIds: [], collectionIds: [] },
      kind,
      value: kind === 'percent' ? pct : kind === 'bxgy' ? Math.round(Number(getPercent.replace(',', '.')) * 100) : kind === 'fixed' ? (fixed ?? 0) : 0,
      minOrderCents: minOrder ?? 0,
      usageLimit: limit.trim() ? Number(limit) : null,
      startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      active,
    };
    setSaving(true);
    const res = isNew
      ? await api<{ discount?: DiscountDto }>('/api/shop/discounts', { method: 'POST', json: body })
      : await api<{ discount?: DiscountDto }>(`/api/shop/discounts/${discount!.id}`, { method: 'PATCH', json: body });
    setSaving(false);
    if (!res.ok || !res.data.discount) return push(errText(res.data.error), 'bad');
    push(t('editor.saved'));
    if (isNew) router.replace(`/app/shop/discounts/${res.data.discount.id}`);
    else router.refresh();
  };

  const remove = async () => {
    const res = await api(`/api/shop/discounts/${discount!.id}`, { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.replace('/app/shop/discounts');
    router.refresh();
  };

  return (
    <div className="app-page ui-page shop-page shop-narrow">
      <PageHeader back={{ href: '/app/shop/discounts', label: t('nav.discounts') }} title={isNew ? t('discounts.new') : discount!.method === 'automatic' ? discount!.title : discount!.code} />
      <form className="panel shop-panel" onSubmit={save}>
        <fieldset className="ui-field shop-fieldset">
          <legend className="label">{t('discounts.method')}</legend>
          <label className="ui-check">
            <input type="radio" name="method" checked={method === 'code'} onChange={() => setMethod('code')} />
            <span>{t('discounts.methodCode')}</span>
          </label>
          <label className="ui-check">
            <input type="radio" name="method" checked={method === 'automatic'} onChange={() => setMethod('automatic')} />
            <span>{t('discounts.methodAuto')}</span>
          </label>
          {method === 'automatic' && <span className="ui-help">{t('discounts.methodAutoHelp')}</span>}
        </fieldset>
        {method === 'code' ? (
          <label className="ui-field">
            <span className="label">{t('discounts.code')}</span>
            <input className="input data" required pattern="[A-Za-z0-9_-]{2,40}" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <span className="ui-help">{t('discounts.codeHelp')}</span>
          </label>
        ) : (
          <label className="ui-field">
            <span className="label">{t('discounts.autoTitle')}</span>
            <input className="input" required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('discounts.autoTitlePh')} name="title" />
            <span className="ui-help">{t('discounts.autoTitleHelp')}</span>
          </label>
        )}
        <fieldset className="ui-field shop-fieldset">
          <legend className="label">{t('discounts.type')}</legend>
          {(['percent', 'fixed', 'free_shipping', 'bxgy'] as const).map((k) => (
            <label key={k} className="ui-check">
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
              <span>{t(`discounts.kinds.${k}`)}</span>
            </label>
          ))}
        </fieldset>
        {kind === 'percent' && (
          <label className="ui-field">
            <span className="label">{t('discounts.percent')}</span>
            <input className="input" inputMode="decimal" required value={percent} onChange={(e) => setPercent(e.target.value)} />
          </label>
        )}
        {kind === 'fixed' && (
          <label className="ui-field">
            <span className="label">{t('discounts.amount', { currency })}</span>
            <MoneyInput id="disc-fixed" label={t('discounts.amount', { currency })} value={fixed} onChange={setFixed} required />
          </label>
        )}
        {kind === 'bxgy' && (
          <div className="shop-po-line">
            <label className="ui-field">
              <span className="label">{t('discounts.buy')}</span>
              <input className="input shop-num-input" type="number" min={1} required value={buy} onChange={(e) => setBuy(e.target.value)} name="buy" />
            </label>
            <label className="ui-field">
              <span className="label">{t('discounts.get')}</span>
              <input className="input shop-num-input" type="number" min={1} required value={get} onChange={(e) => setGet(e.target.value)} name="get" />
            </label>
            <label className="ui-field">
              <span className="label">{t('discounts.getPercent')}</span>
              <input className="input shop-num-input" inputMode="decimal" required value={getPercent} onChange={(e) => setGetPercent(e.target.value)} name="getPercent" />
            </label>
          </div>
        )}
        {kind !== 'free_shipping' && (
          <fieldset className="ui-field shop-fieldset">
            <legend className="label">{t('discounts.appliesTo')}</legend>
            <label className="ui-check">
              <input type="radio" name="scope" checked={!scoped} onChange={() => setScoped(false)} />
              <span>{t('discounts.appliesAll')}</span>
            </label>
            <label className="ui-check">
              <input type="radio" name="scope" checked={scoped} onChange={() => setScoped(true)} />
              <span>{t('discounts.appliesSome')}</span>
            </label>
            {scoped && (
              <div className="shop-scope">
                {collections.length > 0 && (
                  <label className="ui-field">
                    <span className="label">{t('nav.collections')}</span>
                    <select className="select" multiple size={Math.min(5, collections.length)} value={scopeCollections} onChange={(e) => setScopeCollections([...e.target.selectedOptions].map((o) => o.value))}>
                      {collections.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  </label>
                )}
                <label className="ui-field">
                  <span className="label">{t('nav.products')}</span>
                  {products.length > 0 ? (
                    <select className="select" multiple size={Math.min(8, products.length)} value={scopeProducts} onChange={(e) => setScopeProducts([...e.target.selectedOptions].map((o) => o.value))} name="scopeProducts">
                      {products.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  ) : (
                    <span className="ui-help">{t('discounts.noProducts')}</span>
                  )}
                </label>
              </div>
            )}
          </fieldset>
        )}
        <label className="ui-field">
          <span className="label">{t('discounts.minQuantity')}</span>
          <input className="input shop-num-input" type="number" min={0} value={minQty} onChange={(e) => setMinQty(e.target.value)} name="minQuantity" />
        </label>
        <label className="ui-field">
          <span className="label">{t('discounts.minOrderLabel', { currency })}</span>
          <MoneyInput id="disc-min" label={t('discounts.minOrderLabel', { currency })} value={minOrder} onChange={setMinOrder} />
        </label>
        <label className="ui-field">
          <span className="label">{t('discounts.limit')}</span>
          <input className="input" type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} />
          <span className="ui-help">{discount ? t('discounts.used', { n: discount.usedCount }) : t('discounts.limitHelp')}</span>
        </label>
        <div className="ui-fields-2">
          <label className="ui-field">
            <span className="label">{t('discounts.starts')}</span>
            <input className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </label>
          <label className="ui-field">
            <span className="label">{t('discounts.ends')}</span>
            <input className="input" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
        </div>
        <label className="ui-check">
          <input type="checkbox" checked={once} onChange={(e) => setOnce(e.target.checked)} name="once" />
          <span>{t('discounts.oncePerCustomer')}</span>
        </label>
        <label className="ui-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>{t('discounts.activeLabel')}</span>
        </label>
        <div className="shop-actions-row">
          <button type="submit" className="btn btn-primary" aria-busy={saving} disabled={saving}>
            {isNew ? t('discounts.create') : t('editor.save')}
          </button>
          {!isNew && (
            <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
              {t('editor.delete')}
            </button>
          )}
        </div>
      </form>
      <ConfirmDialog
        open={confirm}
        danger
        title={t('discounts.deleteTitle', { code: discount?.method === 'automatic' ? discount.title : (discount?.code ?? '') })}
        body={t('discounts.deleteBody')}
        confirmLabel={t('editor.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(false)}
      />
      {toast}
    </div>
  );
}
