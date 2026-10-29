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
export default function DiscountEditor({ discount, currency }: { discount: DiscountDto | null; currency: string }) {
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
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const pct = Math.round(Number(percent.replace(',', '.')) * 100);
    const body = {
      code: code.trim().toUpperCase(),
      kind,
      value: kind === 'percent' ? pct : kind === 'fixed' ? (fixed ?? 0) : 0,
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
      <PageHeader back={{ href: '/app/shop/discounts', label: t('nav.discounts') }} title={isNew ? t('discounts.new') : discount!.code} />
      <form className="panel shop-panel" onSubmit={save}>
        <label className="ui-field">
          <span className="label">{t('discounts.code')}</span>
          <input className="input data" required pattern="[A-Za-z0-9_-]{2,40}" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <span className="ui-help">{t('discounts.codeHelp')}</span>
        </label>
        <fieldset className="ui-field shop-fieldset">
          <legend className="label">{t('discounts.type')}</legend>
          {(['percent', 'fixed', 'free_shipping'] as const).map((k) => (
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
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>{t('discounts.activeLabel')}</span>
        </label>
        <div className="shop-actions-row">
          <button type="submit" className="btn btn-primary" aria-busy={saving} disabled={saving}>
            {isNew ? t('editor.create') : t('editor.save')}
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
        title={t('discounts.deleteTitle', { code: discount?.code ?? '' })}
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
