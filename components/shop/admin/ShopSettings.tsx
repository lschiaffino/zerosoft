'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import SettingsTabs from '@/components/ui/SettingsTabs';
import type { LocationDto, StoreDto } from '@/lib/shop';
import type { PaymentsView } from '@/lib/shop-payments';
import type { ShippingRate, TaxRate } from '@/lib/shop-money';
import { SHOP_CURRENCIES } from '@/lib/shop-money';
import { MoneyInput, api, useErrorText, useMoney, useToast } from './shop-ui';

const TABS = ['store', 'theme', 'payments', 'shipping', 'taxes', 'locations', 'notifications'] as const;

/** Ajustes de Shop: tienda, tema y marca, cobros, envíos, impuestos, ubicaciones y emails. */
export default function ShopSettings({
  store,
  payments,
  locations,
  shipping,
  taxes,
  canAdmin,
  tab,
  storeUrl,
}: {
  storeUrl: string;
  store: StoreDto;
  payments: PaymentsView | null;
  locations: LocationDto[];
  shipping: ShippingRate[];
  taxes: TaxRate[];
  canAdmin: boolean;
  tab: string;
}) {
  const t = useTranslations('shop');
  const active = (TABS as readonly string[]).includes(tab) ? tab : 'store';
  return (
    <div className="app-page ui-page shop-page">
      <PageHeader title={t('nav.settings')} description={t('settings.desc')} />
      <SettingsTabs mode="query" param="tab" items={TABS.map((k) => ({ key: k, label: t(`settings.tabs.${k}`) }))}>
        {active === 'store' && <StoreTab store={store} storeUrl={storeUrl} canAdmin={canAdmin} />}
        {active === 'theme' && <ThemeTab store={store} />}
        {active === 'payments' && (canAdmin && payments ? <PaymentsTab initial={payments} /> : <p className="ui-help">{t('settings.adminOnly')}</p>)}
        {active === 'shipping' && <ShippingTab initial={shipping} currency={store.currency} />}
        {active === 'taxes' && <TaxesTab initial={taxes} included={store.taxIncluded} />}
        {active === 'locations' && <LocationsTab initial={locations} lowStock={store.lowStock} />}
        {active === 'notifications' && <NotificationsTab store={store} />}
      </SettingsTabs>
    </div>
  );
}

function useSaver() {
  const router = useRouter();
  const errText = useErrorText();
  const t = useTranslations('shop');
  const [toast, push] = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (url: string, method: string, json: unknown): Promise<Record<string, unknown> | null> => {
    setBusy(true);
    const res = await api(url, { method, json });
    setBusy(false);
    if (!res.ok) {
      push(errText(res.data.error), 'bad');
      return null;
    }
    push(t('editor.saved'));
    router.refresh();
    return res.data as Record<string, unknown>;
  };
  return { run, busy, toast, push };
}

function StoreTab({ store, storeUrl, canAdmin }: { store: StoreDto; storeUrl: string; canAdmin: boolean }) {
  const t = useTranslations('shop');
  const { run, busy, toast } = useSaver();
  const [name, setName] = useState(store.name);
  const [handle, setHandle] = useState(store.handle);
  const [currency, setCurrency] = useState(store.currency);
  const [locale, setLocale] = useState(store.locale);
  const [email, setEmail] = useState(store.contactEmail);
  const [published, setPublished] = useState(store.published);
  const save = (e: FormEvent) => {
    e.preventDefault();
    // Dirección, moneda y publicar son de admins (el servidor también lo exige).
    void run('/api/shop/store', 'PATCH', { name, locale, contactEmail: email, ...(canAdmin ? { handle, currency, published } : {}) });
  };
  const url = storeUrl;
  return (
    <form className="ui-section" onSubmit={save}>
      <label className="ui-field">
        <span className="label">{t('settings.name')}</span>
        <input className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="ui-field">
        <span className="label">{t('settings.handle')}</span>
        <input className="input data" required disabled={!canAdmin} pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} />
        <span className="ui-help">{t('settings.handleHelp', { url })}</span>
      </label>
      <div className="ui-fields-2">
        <label className="ui-field">
          <span className="label">{t('settings.currency')}</span>
          <select className="select" value={currency} disabled={!canAdmin} onChange={(e) => setCurrency(e.target.value)}>
            {SHOP_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="ui-field">
          <span className="label">{t('settings.language')}</span>
          <select className="select" value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="pt">Português</option>
          </select>
        </label>
      </div>
      <label className="ui-field">
        <span className="label">{t('settings.contactEmail')}</span>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <span className="ui-help">{t('settings.contactEmailHelp')}</span>
      </label>
      <label className="ui-switch shop-switch">
        <input type="checkbox" role="switch" checked={published} disabled={!canAdmin} onChange={(e) => setPublished(e.target.checked)} name="published" />
        <span>{t('settings.published')}</span>
      </label>
      <p className="ui-help">{t('settings.publishedHelp')}</p>
      {!canAdmin && <p className="ui-help">{t('settings.adminOnlyStore')}</p>}
      <p className="ui-help">{t('settings.customDomain')}</p>
      <div className="ui-section-foot">
        <button type="submit" className="btn btn-primary" aria-busy={busy} disabled={busy}>
          {t('common.save')}
        </button>
      </div>
      {toast}
    </form>
  );
}

function ThemeTab({ store }: { store: StoreDto }) {
  const t = useTranslations('shop');
  const { run, busy, toast, push } = useSaver();
  const errText = useErrorText();
  const [theme, setTheme] = useState(store.theme);
  const [brand, setBrand] = useState(store.brand);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const form = new FormData();
    form.set('file', file);
    const res = await fetch('/api/shop/images', { method: 'POST', body: form });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (res.ok && data.url) setBrand({ ...brand, logoUrl: data.url });
    else push(errText(data.error), 'bad');
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run('/api/shop/store', 'PATCH', { theme, brand });
  };
  return (
    <form className="ui-section" onSubmit={save}>
      <fieldset className="ui-field shop-fieldset">
        <legend className="label">{t('settings.theme')}</legend>
        <div className="shop-themes">
          {(['classic', 'bold', 'minimal'] as const).map((k) => (
            <label key={k} className={`shop-theme-card${theme === k ? ' is-active' : ''}`}>
              <input type="radio" name="theme" className="sr-only" checked={theme === k} onChange={() => setTheme(k)} />
              <span className={`shop-theme-preview shop-theme-${k}`} style={{ ['--p' as string]: brand.primary, ['--a' as string]: brand.accent }} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <strong>{t(`settings.themes.${k}`)}</strong>
              <span className="ui-help">{t(`settings.themeHelp.${k}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="ui-field">
        <span className="label">{t('settings.logo')}</span>
        <div className="shop-logo-row">
          {brand.logoUrl && <img src={brand.logoUrl} alt="" className="shop-logo-preview" />}
          <label className="btn btn-secondary btn-sm">
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} />
            {brand.logoUrl ? t('settings.changeLogo') : t('settings.uploadLogo')}
          </label>
          {brand.logoUrl && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBrand({ ...brand, logoUrl: null })}>
              {t('editor.remove')}
            </button>
          )}
        </div>
      </div>
      <div className="ui-fields-2">
        <label className="ui-field">
          <span className="label">{t('settings.primary')}</span>
          <input className="input shop-color" type="color" value={brand.primary} onChange={(e) => setBrand({ ...brand, primary: e.target.value })} />
        </label>
        <label className="ui-field">
          <span className="label">{t('settings.accent')}</span>
          <input className="input shop-color" type="color" value={brand.accent} onChange={(e) => setBrand({ ...brand, accent: e.target.value })} />
        </label>
      </div>
      <label className="ui-field">
        <span className="label">{t('settings.font')}</span>
        <select className="select" value={brand.font} onChange={(e) => setBrand({ ...brand, font: e.target.value as typeof brand.font })}>
          {(['sans', 'serif', 'mono', 'rounded'] as const).map((f) => (
            <option key={f} value={f}>
              {t(`settings.fonts.${f}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="ui-field">
        <span className="label">{t('settings.heroTitle')}</span>
        <input className="input" maxLength={120} value={brand.heroTitle} onChange={(e) => setBrand({ ...brand, heroTitle: e.target.value })} />
      </label>
      <label className="ui-field">
        <span className="label">{t('settings.heroText')}</span>
        <textarea className="textarea" rows={2} maxLength={400} value={brand.heroText} onChange={(e) => setBrand({ ...brand, heroText: e.target.value })} />
      </label>
      <label className="ui-field">
        <span className="label">{t('settings.announcement')}</span>
        <input className="input" maxLength={160} value={brand.announcement} onChange={(e) => setBrand({ ...brand, announcement: e.target.value })} />
      </label>
      <div className="ui-section-foot">
        <button type="submit" className="btn btn-primary" aria-busy={busy} disabled={busy}>
          {t('common.save')}
        </button>
      </div>
      {toast}
    </form>
  );
}

function PaymentsTab({ initial }: { initial: PaymentsView }) {
  const t = useTranslations('shop');
  const { run, busy, toast, push } = useSaver();
  const [view, setView] = useState(initial);
  const [stripe, setStripe] = useState({ secretKey: '', webhookSecret: '' });
  const [mp, setMp] = useState({ accessToken: '', webhookSecret: '' });
  const [manual, setManual] = useState(initial.manual);
  const save = async (patch: Record<string, unknown>) => {
    const res = await run('/api/shop/payments', 'PUT', patch);
    if (res?.payments) {
      setView(res.payments as PaymentsView);
      setStripe({ secretKey: '', webhookSecret: '' });
      setMp({ accessToken: '', webhookSecret: '' });
    }
  };
  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => push(t('common.copied')));
  return (
    <div className="ui-section shop-payments">
      <section className="panel shop-panel">
        <h2 className="shop-panel-title">Stripe</h2>
        <p className="ui-help">{view.stripe.connected ? t('settings.connected', { last4: view.stripe.last4 ?? '' }) : t('settings.stripeHelp')}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({ stripe: { secretKey: stripe.secretKey, webhookSecret: stripe.webhookSecret } });
          }}
        >
          <label className="ui-field">
            <span className="label">{t('settings.stripeKey')}</span>
            <input className="input data" autoComplete="off" value={stripe.secretKey} placeholder={view.stripe.connected ? '••••' : ''} onChange={(e) => setStripe({ ...stripe, secretKey: e.target.value })} name="stripeKey" />
          </label>
          <label className="ui-field">
            <span className="label">{t('settings.stripeWebhookSecret')}</span>
            <input className="input data" autoComplete="off" value={stripe.webhookSecret} placeholder={view.stripe.webhookSecretSet ? '••••' : 'whsec_…'} onChange={(e) => setStripe({ ...stripe, webhookSecret: e.target.value })} name="stripeWebhookSecret" />
          </label>
          <div className="ui-field">
            <span className="label">{t('settings.webhookUrl')}</span>
            <div className="ui-input-group">
              <input className="input data" readOnly value={view.stripe.webhookUrl} aria-label={t('settings.webhookUrl')} />
              <button type="button" className="btn btn-secondary" onClick={() => copy(view.stripe.webhookUrl)}>
                {t('common.copy')}
              </button>
            </div>
            <span className="ui-help">{t('settings.stripeWebhookHelp')}</span>
          </div>
          <div className="shop-actions-row">
            <button type="submit" className="btn btn-primary" disabled={busy || (!stripe.secretKey && !stripe.webhookSecret)}>
              {view.stripe.connected ? t('common.save') : t('settings.connect')}
            </button>
            {view.stripe.connected && (
              <button type="button" className="btn btn-ghost" onClick={() => void save({ stripe: null })}>
                {t('settings.disconnect')}
              </button>
            )}
          </div>
        </form>
      </section>
      <section className="panel shop-panel">
        <h2 className="shop-panel-title">Mercado Pago</h2>
        <p className="ui-help">{view.mercadopago.connected ? t('settings.connected', { last4: view.mercadopago.last4 ?? '' }) : t('settings.mpHelp')}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({ mercadopago: { accessToken: mp.accessToken, webhookSecret: mp.webhookSecret } });
          }}
        >
          <label className="ui-field">
            <span className="label">{t('settings.mpToken')}</span>
            <input className="input data" autoComplete="off" value={mp.accessToken} placeholder={view.mercadopago.connected ? '••••' : ''} onChange={(e) => setMp({ ...mp, accessToken: e.target.value })} name="mpToken" />
          </label>
          <label className="ui-field">
            <span className="label">{t('settings.mpWebhookSecret')}</span>
            <input className="input data" autoComplete="off" value={mp.webhookSecret} placeholder={view.mercadopago.webhookSecretSet ? '••••' : ''} onChange={(e) => setMp({ ...mp, webhookSecret: e.target.value })} name="mpWebhookSecret" />
          </label>
          <div className="ui-field">
            <span className="label">{t('settings.webhookUrl')}</span>
            <div className="ui-input-group">
              <input className="input data" readOnly value={view.mercadopago.webhookUrl} aria-label={t('settings.webhookUrl')} />
              <button type="button" className="btn btn-secondary" onClick={() => copy(view.mercadopago.webhookUrl)}>
                {t('common.copy')}
              </button>
            </div>
            <span className="ui-help">{t('settings.mpWebhookHelp')}</span>
          </div>
          <div className="shop-actions-row">
            <button type="submit" className="btn btn-primary" disabled={busy || (!mp.accessToken && !mp.webhookSecret)}>
              {view.mercadopago.connected ? t('common.save') : t('settings.connect')}
            </button>
            {view.mercadopago.connected && (
              <button type="button" className="btn btn-ghost" onClick={() => void save({ mercadopago: null })}>
                {t('settings.disconnect')}
              </button>
            )}
          </div>
        </form>
      </section>
      <section className="panel shop-panel">
        <h2 className="shop-panel-title">{t('settings.manualTitle')}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({ manual });
          }}
        >
          <label className="ui-check">
            <input type="checkbox" checked={manual.enabled} onChange={(e) => setManual({ ...manual, enabled: e.target.checked })} name="manualEnabled" />
            <span>{t('settings.manualEnable')}</span>
          </label>
          <label className="ui-field">
            <span className="label">{t('settings.manualLabel')}</span>
            <input className="input" maxLength={80} value={manual.label} placeholder={t('settings.manualLabelPh')} onChange={(e) => setManual({ ...manual, label: e.target.value })} />
          </label>
          <label className="ui-field">
            <span className="label">{t('settings.manualInstructions')}</span>
            <textarea className="textarea" rows={4} maxLength={2000} value={manual.instructions} placeholder={t('settings.manualInstructionsPh')} onChange={(e) => setManual({ ...manual, instructions: e.target.value })} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t('common.save')}
          </button>
        </form>
      </section>
      <p className="ui-help">{t('settings.paymentsDocs')}</p>
      {toast}
    </div>
  );
}

function ShippingTab({ initial, currency }: { initial: ShippingRate[]; currency: string }) {
  const t = useTranslations('shop');
  const money = useMoney(currency);
  const { run, busy, toast } = useSaver();
  const [rates, setRates] = useState(initial.map((r) => ({ ...r, countriesText: r.countries.join(', ') })));
  const set = (i: number, patch: Partial<(typeof rates)[number]>) => setRates((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run('/api/shop/shipping', 'PUT', {
      rates: rates.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        countries: r.countriesText.split(/[\s,]+/).map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
        priceCents: r.priceCents,
        minWeightG: r.kind === 'weight' ? r.minWeightG : null,
        maxWeightG: r.kind === 'weight' ? r.maxWeightG : null,
        freeOverCents: r.freeOverCents,
      })),
    });
  };
  return (
    <form className="ui-section" onSubmit={save}>
      <p className="ui-help">{t('settings.shippingHelp')}</p>
      {rates.length === 0 && <p className="ui-help">{t('settings.noRates')}</p>}
      {rates.map((r, i) => (
        <fieldset key={r.id || i} className="panel shop-panel shop-rate">
          <legend className="sr-only">{r.name || t('settings.rate')}</legend>
          <div className="ui-fields-2">
            <label className="ui-field">
              <span className="label">{t('settings.rateName')}</span>
              <input className="input" required maxLength={80} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
            </label>
            <label className="ui-field">
              <span className="label">{t('settings.rateKind')}</span>
              <select className="select" value={r.kind} onChange={(e) => set(i, { kind: e.target.value as 'flat' | 'weight' })}>
                <option value="flat">{t('settings.kindFlat')}</option>
                <option value="weight">{t('settings.kindWeight')}</option>
              </select>
            </label>
          </div>
          <div className="ui-fields-2">
            <label className="ui-field">
              <span className="label">{t('settings.ratePrice', { currency })}</span>
              <MoneyInput id={`rate-${i}`} label={t('settings.ratePrice', { currency })} value={r.priceCents} onChange={(c) => set(i, { priceCents: c ?? 0 })} required />
            </label>
            <label className="ui-field">
              <span className="label">{t('settings.freeOver', { currency })}</span>
              <MoneyInput id={`free-${i}`} label={t('settings.freeOver', { currency })} value={r.freeOverCents} onChange={(c) => set(i, { freeOverCents: c })} />
            </label>
          </div>
          {r.kind === 'weight' && (
            <div className="ui-fields-2">
              <label className="ui-field">
                <span className="label">{t('settings.minWeight')}</span>
                <input className="input" type="number" min={0} value={r.minWeightG ?? ''} onChange={(e) => set(i, { minWeightG: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
              <label className="ui-field">
                <span className="label">{t('settings.maxWeight')}</span>
                <input className="input" type="number" min={0} value={r.maxWeightG ?? ''} onChange={(e) => set(i, { maxWeightG: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
            </div>
          )}
          <label className="ui-field">
            <span className="label">{t('settings.countries')}</span>
            <input className="input data" value={r.countriesText} placeholder="AR, UY, CL" onChange={(e) => set(i, { countriesText: e.target.value })} />
            <span className="ui-help">{t('settings.countriesHelp')}</span>
          </label>
          <p className="ui-help">
            {money(r.priceCents)}
            {r.freeOverCents != null ? ` · ${t('settings.freeFrom', { amount: money(r.freeOverCents) })}` : ''}
          </p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRates((cur) => cur.filter((_, j) => j !== i))}>
            {t('editor.remove')}
          </button>
        </fieldset>
      ))}
      <div className="shop-actions-row">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setRates([...rates, { id: '', name: '', kind: 'flat', countries: [], countriesText: '', priceCents: 0, minWeightG: null, maxWeightG: null, freeOverCents: null }])}
        >
          {t('settings.addRate')}
        </button>
        <button type="submit" className="btn btn-primary" aria-busy={busy} disabled={busy}>
          {t('common.save')}
        </button>
      </div>
      {toast}
    </form>
  );
}

function TaxesTab({ initial, included }: { initial: TaxRate[]; included: boolean }) {
  const t = useTranslations('shop');
  const { run, busy, toast } = useSaver();
  const [taxIncluded, setTaxIncluded] = useState(included);
  const [rates, setRates] = useState(initial.map((r) => ({ ...r, pct: String(r.rateBps / 100) })));
  const set = (i: number, patch: Partial<(typeof rates)[number]>) => setRates((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run('/api/shop/taxes', 'PUT', {
      rates: rates.map((r) => ({ country: r.country.toUpperCase(), region: r.region, rateBps: Math.round(Number(r.pct.replace(',', '.')) * 100), name: r.name, appliesToShipping: r.appliesToShipping })),
    });
    if (ok) await run('/api/shop/store', 'PATCH', { taxIncluded });
  };
  return (
    <form className="ui-section" onSubmit={save}>
      <label className="ui-check">
        <input type="checkbox" checked={taxIncluded} onChange={(e) => setTaxIncluded(e.target.checked)} />
        <span>{t('settings.taxIncluded')}</span>
      </label>
      <p className="ui-help">{t('settings.taxHelp')}</p>
      {rates.map((r, i) => (
        <div key={i} className="shop-tax-row">
          <input className="input data" aria-label={t('settings.country')} required maxLength={2} value={r.country} placeholder="AR" onChange={(e) => set(i, { country: e.target.value.toUpperCase() })} />
          <input className="input" aria-label={t('settings.region')} value={r.region} placeholder={t('settings.regionPh')} onChange={(e) => set(i, { region: e.target.value })} />
          <input className="input" aria-label={t('settings.taxName')} value={r.name} placeholder={t('settings.taxNamePh')} onChange={(e) => set(i, { name: e.target.value })} />
          <input className="input shop-num-input" aria-label={t('settings.rate')} inputMode="decimal" required value={r.pct} onChange={(e) => set(i, { pct: e.target.value })} />
          <label className="ui-check">
            <input type="checkbox" checked={r.appliesToShipping} onChange={(e) => set(i, { appliesToShipping: e.target.checked })} />
            <span>{t('settings.onShipping')}</span>
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRates((cur) => cur.filter((_, j) => j !== i))}>
            {t('editor.remove')}
          </button>
        </div>
      ))}
      <div className="shop-actions-row">
        <button type="button" className="btn btn-secondary" onClick={() => setRates([...rates, { country: '', region: '', rateBps: 0, pct: '', name: '', appliesToShipping: false }])}>
          {t('settings.addTax')}
        </button>
        <button type="submit" className="btn btn-primary" aria-busy={busy} disabled={busy}>
          {t('common.save')}
        </button>
      </div>
      {toast}
    </form>
  );
}

function LocationsTab({ initial, lowStock }: { initial: LocationDto[]; lowStock: number }) {
  const t = useTranslations('shop');
  const { run, busy, toast } = useSaver();
  const [name, setName] = useState('');
  const [low, setLow] = useState(String(lowStock));
  return (
    <div className="ui-section">
      <ul className="shop-items">
        {initial.map((l) => (
          <li key={l.id}>
            <span>{l.name}</span>
            {l.isDefault ? (
              <span className="badge badge-outline">{t('settings.default')}</span>
            ) : (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run(`/api/shop/locations/${l.id}`, 'PATCH', { isDefault: true })}>
                  {t('settings.makeDefault')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run(`/api/shop/locations/${l.id}`, 'DELETE', {})}>
                  {t('editor.remove')}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="shop-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void run('/api/shop/locations', 'POST', { name }).then((ok) => ok && setName(''));
        }}
      >
        <input className="input" value={name} maxLength={80} placeholder={t('settings.locationPh')} aria-label={t('settings.locationName')} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-secondary" disabled={busy || !name.trim()}>
          {t('settings.addLocation')}
        </button>
      </form>
      <form
        className="shop-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run('/api/shop/store', 'PATCH', { lowStock: Number(low) || 0 });
        }}
      >
        <label className="ui-field">
          <span className="label">{t('settings.lowStock')}</span>
          <input className="input shop-num-input" type="number" min={0} value={low} onChange={(e) => setLow(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          {t('common.save')}
        </button>
      </form>
      {toast}
    </div>
  );
}

function NotificationsTab({ store }: { store: StoreDto }) {
  const t = useTranslations('shop');
  const { run, busy, toast } = useSaver();
  const [s, setS] = useState(store.settings);
  return (
    <form
      className="ui-section"
      onSubmit={(e) => {
        e.preventDefault();
        void run('/api/shop/store', 'PATCH', { settings: s });
      }}
    >
      <label className="ui-check">
        <input type="checkbox" checked={s.emailConfirmation} onChange={(e) => setS({ ...s, emailConfirmation: e.target.checked })} />
        <span>{t('settings.emailConfirmation')}</span>
      </label>
      <label className="ui-check">
        <input type="checkbox" checked={s.emailShipped} onChange={(e) => setS({ ...s, emailShipped: e.target.checked })} />
        <span>{t('settings.emailShipped')}</span>
      </label>
      <label className="ui-check">
        <input type="checkbox" checked={s.crmSync} onChange={(e) => setS({ ...s, crmSync: e.target.checked })} />
        <span>{t('settings.crmSync')}</span>
      </label>
      <label className="ui-field">
        <span className="label">{t('settings.holdMinutes')}</span>
        <input className="input shop-num-input" type="number" min={15} max={10080} value={s.holdMinutes} onChange={(e) => setS({ ...s, holdMinutes: Number(e.target.value) || 60 })} />
        <span className="ui-help">{t('settings.holdHelp')}</span>
      </label>
      <p className="ui-help">{t('settings.emailFrom')}</p>
      <button type="submit" className="btn btn-primary" aria-busy={busy} disabled={busy}>
        {t('common.save')}
      </button>
      {toast}
    </form>
  );
}
