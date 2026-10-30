'use client';

import { SETTINGS_TABS, type SettingsTab } from '@/lib/books-tabs';
import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { AuditEntry, SettingsDto, TaxRateRow, SeriesRow } from '@/lib/books';
import type { BooksPaymentsView } from '@/lib/books-payments';
import type { EInvoiceView } from '@/lib/books-einvoice';
import type { BooksRole } from '@/lib/books-roles';
import { bpsToPercent, percentToBps } from '@/lib/books-money';
import { api, useDate, useErrorText, useToast } from './ui';


export default function BooksSettings({
  tab,
  settings,
  admin,
  canWrite,
  canAudit,
  taxes,
  series,
  payments,
  einvoice,
  roles,
  people,
  audit,
}: {
  tab: SettingsTab;
  settings: SettingsDto;
  admin: boolean;
  canWrite: boolean;
  canAudit: boolean;
  taxes: TaxRateRow[];
  series: SeriesRow[];
  payments: BooksPaymentsView | null;
  einvoice: EInvoiceView | null;
  roles: Array<{ personId: string; role: BooksRole }> | null;
  people: Array<{ id: string; name: string | null; email: string; role: string }>;
  audit: AuditEntry[];
}) {
  const t = useTranslations('books');
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const visible = SETTINGS_TABS.filter((x) => (x === 'payments' || x === 'einvoice' || x === 'roles' ? admin : x === 'audit' ? canAudit : true));

  const patch = async (body: Record<string, unknown>, url = '/api/books/settings', method = 'PATCH') => {
    const res = await api(url, { method, json: body });
    if (!res.ok) {
      push(errText(res.data.error), 'bad');
      return false;
    }
    push(t('common.saved'));
    router.refresh();
    return true;
  };

  return (
    <div className="app-page ui-page bk-page">
      {toast}
      <PageHeader title={t('nav.settings')} description={t('settings.desc')} />
      <nav className="ui-tabs bk-filter" aria-label={t('nav.settings')}>
        {visible.map((x) => (
          <Link key={x} className="ui-tab" aria-current={tab === x ? 'page' : undefined} aria-selected={tab === x} href={`/app/books/settings?tab=${x}`}>
            {t(`settings.tabs.${x}`)}
          </Link>
        ))}
      </nav>
      {tab === 'company' && <Company settings={settings} canWrite={canWrite} admin={admin} patch={patch} push={push} />}
      {tab === 'taxes' && <Taxes taxes={taxes} canWrite={canWrite} patch={patch} />}
      {tab === 'series' && <Series series={series} canWrite={canWrite} patch={patch} country={settings.country} />}
      {tab === 'reminders' && <Reminders settings={settings} canWrite={canWrite} admin={admin} patch={patch} />}
      {tab === 'payments' && payments && <Payments payments={payments} patch={patch} />}
      {tab === 'einvoice' && einvoice && <EInvoice einvoice={einvoice} patch={patch} />}
      {tab === 'roles' && roles && <Roles roles={roles} people={people} patch={patch} />}
      {tab === 'integrations' && <Integrations settings={settings} canWrite={canWrite} patch={patch} />}
      {tab === 'audit' && canAudit && <Audit entries={audit} />}
    </div>
  );
}

type Patch = (body: Record<string, unknown>, url?: string, method?: string) => Promise<boolean>;

function Company({ settings, canWrite, admin, patch, push }: { settings: SettingsDto; canWrite: boolean; admin: boolean; patch: Patch; push: (m: string, tone?: 'ok' | 'bad') => void }) {
  const t = useTranslations('books');
  const router = useRouter();
  const errText = useErrorText();
  const [f, setF] = useState({
    legalName: settings.legalName,
    tradeName: settings.tradeName,
    taxId: settings.taxId,
    taxCondition: settings.taxCondition,
    address: settings.address,
    email: settings.email,
    phone: settings.phone,
    brandColor: settings.brandColor,
    footer: settings.footer,
    termsDays: String(settings.termsDays),
  });
  const [country, setCountry] = useState(settings.country);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    await patch({ ...f, termsDays: Number(f.termsDays) || 0 });
  };
  const uploadLogo = async (file: File) => {
    const form = new FormData();
    form.set('file', file);
    const res = await api('/api/books/settings/logo', { method: 'POST', body: form });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.refresh();
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <form className="panel bk-panel" onSubmit={save}>
        <fieldset className="bk-fieldset" disabled={!canWrite}>
          <div className="bk-grid">
            <label className="ui-field">
              <span className="label">{t('settings.legalName')}</span>
              <input className="input" maxLength={160} value={f.legalName} onChange={set('legalName')} />
            </label>
            <label className="ui-field">
              <span className="label">{t('settings.tradeName')}</span>
              <input className="input" maxLength={160} value={f.tradeName} onChange={set('tradeName')} />
            </label>
            <label className="ui-field">
              <span className="label">{settings.country === 'AR' ? 'CUIT' : settings.country === 'MX' ? 'RFC' : t('settings.taxId')}</span>
              <input className="input data" maxLength={40} value={f.taxId} onChange={set('taxId')} />
              <span className="ui-help">{t('settings.taxIdHelp')}</span>
            </label>
            {settings.country === 'AR' && (
              <label className="ui-field">
                <span className="label">{t('contacts.taxCondition')}</span>
                <select className="select" value={f.taxCondition} onChange={set('taxCondition')}>
                  {['ri', 'monotributo', 'exento'].map((k) => (
                    <option key={k} value={k}>
                      {t(`taxConditions.${k}`)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="ui-field">
              <span className="label">{t('contacts.email')}</span>
              <input className="input" type="email" value={f.email} onChange={set('email')} />
            </label>
            <label className="ui-field">
              <span className="label">{t('contacts.phone')}</span>
              <input className="input" maxLength={40} value={f.phone} onChange={set('phone')} />
            </label>
            <label className="ui-field">
              <span className="label">{t('settings.terms')}</span>
              <input className="input num" type="number" min={0} max={365} value={f.termsDays} onChange={set('termsDays')} />
            </label>
            <label className="ui-field">
              <span className="label">{t('settings.brandColor')}</span>
              <input className="input bk-color" type="color" value={f.brandColor} onChange={set('brandColor')} />
            </label>
          </div>
          <label className="ui-field">
            <span className="label">{t('contacts.address')}</span>
            <textarea className="textarea" rows={2} maxLength={400} value={f.address} onChange={set('address')} />
          </label>
          <label className="ui-field">
            <span className="label">{t('settings.footer')}</span>
            <textarea className="textarea" rows={2} maxLength={1000} value={f.footer} onChange={set('footer')} placeholder={t('settings.footerPh')} />
          </label>
        </fieldset>
        {canWrite && (
          <div className="bk-row">
            <button type="submit" className="btn btn-primary">
              {t('common.save')}
            </button>
          </div>
        )}
      </form>
      <section className="panel bk-panel">
        <h2 className="bk-panel-title">{t('settings.logo')}</h2>
        {settings.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="bk-logo" src={settings.logoUrl} alt={t('settings.logo')} />
        ) : (
          <p className="ui-help">{t('settings.noLogo')}</p>
        )}
        {canWrite && (
          <div className="bk-row">
            <label className="btn btn-secondary btn-sm bk-file">
              {t('settings.uploadLogo')}
              <input
                type="file"
                className="sr-only"
                accept="image/png,image/jpeg"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadLogo(file);
                  e.target.value = '';
                }}
              />
            </label>
            {settings.logoUrl && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch({ logoUrl: null })}>
                {t('settings.removeLogo')}
              </button>
            )}
          </div>
        )}
        <p className="ui-help">{t('settings.logoHelp')}</p>
      </section>
      {admin && (
        <section className="panel bk-panel">
          <h2 className="bk-panel-title">{t('settings.country')}</h2>
          <p className="ui-help">{t('settings.countryHelp', { currency: settings.baseCurrency })}</p>
          <div className="bk-row">
            <select className="select" aria-label={t('settings.country')} value={country} onChange={(e) => setCountry(e.target.value as SettingsDto['country'])}>
              {['AR', 'MX', 'generic'].map((c) => (
                <option key={c} value={c}>
                  {t(`settings.countries.${c}`)}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-secondary btn-sm" disabled={country === settings.country} onClick={() => patch({ country }, '/api/books/settings/country', 'POST')}>
              {t('settings.applyCountry')}
            </button>
          </div>
        </section>
      )}
    </>
  );
}

function Taxes({ taxes, canWrite, patch }: { taxes: TaxRateRow[]; canWrite: boolean; patch: Patch }) {
  const t = useTranslations('books');
  const [nf, setNf] = useState({ name: '', rate: '' });
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const bps = percentToBps(nf.rate);
    if (bps == null) return;
    if (await patch({ name: nf.name, rateBps: bps }, '/api/books/taxes', 'POST')) setNf({ name: '', rate: '' });
  };
  return (
    <section className="panel bk-panel">
      <p className="ui-help">{t('settings.taxesHelp')}</p>
      <ul className="bk-list">
        {taxes.map((x) => (
          <li key={x.id}>
            <span className="bk-ellipsis">{x.name}</span>
            <span className="data">{bpsToPercent(x.rate_bps)}%</span>
            {x.is_default ? (
              <span className="badge badge-info">{t('settings.default')}</span>
            ) : (
              canWrite && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch({ isDefault: true }, `/api/books/taxes/${x.id}`)}>
                  {t('settings.makeDefault')}
                </button>
              )
            )}
            {canWrite && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch({ archived: true }, `/api/books/taxes/${x.id}`)}>
                {t('accounts.archive')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <form className="bk-row" onSubmit={add}>
          <input className="input" required maxLength={80} placeholder={t('settings.taxName')} aria-label={t('settings.taxName')} value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} />
          <input className="input num bk-cell-xs" required inputMode="decimal" placeholder="21" aria-label={t('settings.taxRate')} value={nf.rate} onChange={(e) => setNf({ ...nf, rate: e.target.value })} />
          <button type="submit" className="btn btn-secondary btn-sm">
            {t('settings.addTax')}
          </button>
        </form>
      )}
    </section>
  );
}

function Series({ series, canWrite, patch, country }: { series: SeriesRow[]; canWrite: boolean; patch: Patch; country: string }) {
  const t = useTranslations('books');
  const [nf, setNf] = useState({ docType: 'invoice', name: '', letter: '', pointOfSale: '2' });
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await patch({ ...nf, pointOfSale: Number(nf.pointOfSale) }, '/api/books/series', 'POST')) setNf({ ...nf, name: '' });
  };
  return (
    <section className="panel bk-panel">
      <p className="ui-help">{country === 'AR' ? t('settings.seriesHelpAr') : t('settings.seriesHelp')}</p>
      <div className="table-wrap bk-table-wrap">
        <table className="table bk-table">
          <thead>
            <tr>
              <th scope="col">{t('settings.seriesName')}</th>
              <th scope="col">{t('settings.docType')}</th>
              <th scope="col" className="num">
                {t('settings.pos')}
              </th>
              <th scope="col" className="num">
                {t('settings.next')}
              </th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.id}>
                <th scope="row">
                  {s.name}
                  {s.letter ? <span className="bk-rowmeta"> · {s.letter}</span> : null}
                </th>
                <td>{t(`settings.docTypes.${s.doc_type}`)}</td>
                <td className="num data">{String(s.point_of_sale).padStart(4, '0')}</td>
                <td className="num data">{s.next_number}</td>
                <td className="num">
                  {s.is_default ? (
                    <span className="badge badge-info">{t('settings.default')}</span>
                  ) : (
                    canWrite && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch({ isDefault: true }, `/api/books/series/${s.id}`)}>
                        {t('settings.makeDefault')}
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canWrite && (
        <form className="bk-row" onSubmit={add}>
          <select className="select" aria-label={t('settings.docType')} value={nf.docType} onChange={(e) => setNf({ ...nf, docType: e.target.value })}>
            <option value="invoice">{t('settings.docTypes.invoice')}</option>
            <option value="credit_note">{t('settings.docTypes.credit_note')}</option>
          </select>
          <input className="input" required maxLength={80} placeholder={t('settings.seriesName')} aria-label={t('settings.seriesName')} value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} />
          <input className="input bk-cell-xs" maxLength={3} placeholder={t('settings.letter')} aria-label={t('settings.letter')} value={nf.letter} onChange={(e) => setNf({ ...nf, letter: e.target.value.toUpperCase() })} />
          <input className="input num bk-cell-xs" type="number" min={1} max={99999} aria-label={t('settings.pos')} value={nf.pointOfSale} onChange={(e) => setNf({ ...nf, pointOfSale: e.target.value })} />
          <button type="submit" className="btn btn-secondary btn-sm">
            {t('settings.addSeries')}
          </button>
        </form>
      )}
    </section>
  );
}

function Reminders({ settings, canWrite, admin, patch }: { settings: SettingsDto; canWrite: boolean; admin: boolean; patch: Patch }) {
  const t = useTranslations('books');
  const [enabled, setEnabled] = useState(settings.reminders.enabled);
  const [days, setDays] = useState(settings.reminders.days.join(', '));
  const [lock, setLock] = useState(settings.lockDate ?? '');
  return (
    <>
      <form
        className="panel bk-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void patch({ reminders: { enabled, days: days.split(/[,\s]+/).filter(Boolean).map(Number) } });
        }}
      >
        <h2 className="bk-panel-title">{t('settings.reminders')}</h2>
        <fieldset className="bk-fieldset" disabled={!canWrite}>
          <label className="ui-check">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>{t('settings.remindersOn')}</span>
          </label>
          <label className="ui-field">
            <span className="label">{t('settings.reminderDays')}</span>
            <input className="input" value={days} onChange={(e) => setDays(e.target.value)} placeholder="3, 10, 30" />
            <span className="ui-help">{t('settings.reminderHelp')}</span>
          </label>
        </fieldset>
        {canWrite && (
          <div className="bk-row">
            <button type="submit" className="btn btn-primary">
              {t('common.save')}
            </button>
          </div>
        )}
      </form>
      <form
        className="panel bk-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void patch({ lockDate: lock || null });
        }}
      >
        <h2 className="bk-panel-title">{t('settings.lockDate')}</h2>
        <p className="ui-help">{t('settings.lockHelp')}</p>
        {!admin && <p className="ui-help">{t('settings.lockAdminOnly')}</p>}
        <fieldset className="bk-fieldset" disabled={!admin}>
          <input className="input" type="date" aria-label={t('settings.lockDate')} value={lock} onChange={(e) => setLock(e.target.value)} />
        </fieldset>
        {admin && (
          <div className="bk-row">
            <button type="submit" className="btn btn-primary">
              {t('common.save')}
            </button>
            {settings.lockDate && (
              <button type="button" className="btn btn-ghost" onClick={() => patch({ lockDate: null })}>
                {t('settings.unlock')}
              </button>
            )}
          </div>
        )}
      </form>
    </>
  );
}

function Payments({ payments, patch }: { payments: BooksPaymentsView; patch: Patch }) {
  const t = useTranslations('books');
  const [stripe, setStripe] = useState({ secretKey: '', webhookSecret: '' });
  const [mp, setMp] = useState({ accessToken: '', webhookSecret: '' });
  const block = (provider: 'stripe' | 'mercadopago') => {
    const v = payments[provider];
    return (
      <form
        className="panel bk-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void patch(provider === 'stripe' ? { stripe } : { mercadopago: mp }, '/api/books/settings/payments').then((ok) => {
            if (ok) {
              setStripe({ secretKey: '', webhookSecret: '' });
              setMp({ accessToken: '', webhookSecret: '' });
            }
          });
        }}
      >
        <div className="bk-panel-head">
          <h2 className="bk-panel-title">{provider === 'stripe' ? 'Stripe' : 'Mercado Pago'}</h2>
          <span className={`badge ${v.connected ? 'badge-ok' : 'badge-outline'}`}>{v.connected ? t('settings.connected', { last4: v.last4 ?? '' }) : t('settings.notConnected')}</span>
        </div>
        <label className="ui-field">
          <span className="label">{provider === 'stripe' ? t('settings.stripeKey') : t('settings.mpToken')}</span>
          <input
            className="input data"
            type="password"
            autoComplete="off"
            value={provider === 'stripe' ? stripe.secretKey : mp.accessToken}
            placeholder={v.connected ? t('settings.keepSecret') : ''}
            onChange={(e) => (provider === 'stripe' ? setStripe({ ...stripe, secretKey: e.target.value }) : setMp({ ...mp, accessToken: e.target.value }))}
          />
        </label>
        <label className="ui-field">
          <span className="label">{t('settings.webhookSecret')}</span>
          <input
            className="input data"
            type="password"
            autoComplete="off"
            value={provider === 'stripe' ? stripe.webhookSecret : mp.webhookSecret}
            placeholder={v.webhookSecretSet ? t('settings.keepSecret') : ''}
            onChange={(e) => (provider === 'stripe' ? setStripe({ ...stripe, webhookSecret: e.target.value }) : setMp({ ...mp, webhookSecret: e.target.value }))}
          />
        </label>
        <p className="ui-help">{t('settings.webhookUrl')}</p>
        <p className="data bk-break">{v.webhookUrl}</p>
        <p className="ui-help">{provider === 'stripe' ? t('settings.stripeEvents') : t('settings.mpEvents')}</p>
        <div className="bk-row">
          <button type="submit" className="btn btn-primary">
            {t('common.save')}
          </button>
          {v.connected && (
            <button type="button" className="btn btn-ghost btn-danger" onClick={() => patch(provider === 'stripe' ? { stripe: null } : { mercadopago: null }, '/api/books/settings/payments')}>
              {t('settings.disconnect')}
            </button>
          )}
        </div>
      </form>
    );
  };
  return (
    <>
      <p className="ui-help bk-note">{t('settings.paymentsHelp')}</p>
      {block('stripe')}
      {block('mercadopago')}
      <section className="panel bk-panel">
        <h2 className="bk-panel-title">{t('settings.rotateTitle')}</h2>
        <p className="ui-help">{t('settings.rotateHelp')}</p>
        <div className="bk-row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => patch({}, '/api/books/settings/webhook-token', 'POST')}>
            {t('settings.rotate')}
          </button>
        </div>
      </section>
    </>
  );
}

function EInvoice({ einvoice, patch }: { einvoice: EInvoiceView; patch: Patch }) {
  const t = useTranslations('books');
  const [provider, setProvider] = useState<string>(einvoice.provider ?? '');
  const [env, setEnv] = useState<string>(einvoice.env);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const current = einvoice.providers.find((p) => p.id === provider) ?? null;
  return (
    <form
      className="panel bk-panel"
      onSubmit={(e) => {
        e.preventDefault();
        void patch({ provider: provider || null, env, credentials: creds }, '/api/books/settings/einvoice').then((ok) => ok && setCreds({}));
      }}
    >
      <p className="bk-note" role="note">
        {t('settings.einvoiceHonest')}
      </p>
      <label className="ui-field">
        <span className="label">{t('settings.provider')}</span>
        <select className="select" value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="">{t('settings.noProvider')}</option>
          {einvoice.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.implemented ? '' : ` (${t('settings.notImplemented')})`}
            </option>
          ))}
        </select>
      </label>
      {current && current.id !== 'test' && (
        <>
          <label className="ui-field">
            <span className="label">{t('settings.environment')}</span>
            <select className="select" value={env} onChange={(e) => setEnv(e.target.value)}>
              <option value="homologacion">{t('settings.envTest')}</option>
              <option value="produccion">{t('settings.envProd')}</option>
            </select>
          </label>
          {current.fields.map((f) => (
            <label key={f.key} className="ui-field">
              <span className="label">{f.label}</span>
              {f.multiline ? (
                <textarea
                  className="textarea data"
                  rows={3}
                  value={creds[f.key] ?? ''}
                  placeholder={f.set ? t('settings.keepSecret') : ''}
                  onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                />
              ) : (
                <input
                  className="input data"
                  type={f.secret ? 'password' : 'text'}
                  autoComplete="off"
                  value={creds[f.key] ?? (f.secret ? '' : (f.value ?? ''))}
                  placeholder={f.set && f.secret ? t('settings.keepSecret') : ''}
                  onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                />
              )}
            </label>
          ))}
          {!current.implemented && <p className="ui-error">{t('settings.providerPending')}</p>}
        </>
      )}
      {current?.id === 'test' && <p className="ui-help">{t('settings.testProviderHelp')}</p>}
      <p className="ui-help">{t('settings.einvoiceDocs')}</p>
      <div className="bk-row">
        <button type="submit" className="btn btn-primary">
          {t('common.save')}
        </button>
      </div>
    </form>
  );
}

function Roles({ roles, people, patch }: { roles: Array<{ personId: string; role: BooksRole }>; people: Array<{ id: string; name: string | null; email: string; role: string }>; patch: Patch }) {
  const t = useTranslations('books');
  return (
    <section className="panel bk-panel">
      <p className="ui-help">{t('settings.rolesHelp')}</p>
      {people.length === 0 ? (
        <p className="ui-help">{t('settings.noPeople')}</p>
      ) : (
        <ul className="bk-list">
          {people.map((p) => {
            const fixed = p.role === 'owner' || p.role === 'admin';
            const current = fixed ? 'accountant' : (roles.find((r) => r.personId === p.id)?.role ?? 'viewer');
            return (
              <li key={p.id}>
                <span className="bk-ellipsis">{p.name || p.email}</span>
                <span className="bk-rowmeta bk-ellipsis">{p.email}</span>
                <select className="select" aria-label={t('settings.roleFor', { name: p.name || p.email })} value={current} disabled={fixed} onChange={(e) => patch({ personId: p.id, role: e.target.value }, '/api/books/settings/roles', 'PUT')}>
                  {(['accountant', 'sales', 'viewer'] as const).map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}
      <ul className="ui-help bk-roles-legend">
        {(['accountant', 'sales', 'viewer'] as const).map((r) => (
          <li key={r}>
            <strong>{t(`roles.${r}`)}:</strong> {t(`roles.${r}Desc`)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Integrations({ settings, canWrite, patch }: { settings: SettingsDto; canWrite: boolean; patch: Patch }) {
  const t = useTranslations('books');
  return (
    <section className="panel bk-panel">
      <label className="ui-check">
        <input type="checkbox" disabled={!canWrite} checked={settings.shopAutoPost} onChange={(e) => patch({ shopAutoPost: e.target.checked })} />
        <span>{t('settings.shopAutoPost')}</span>
      </label>
      <p className="ui-help">{t('settings.shopAutoPostHelp')}</p>
      <label className="ui-check">
        <input type="checkbox" disabled={!canWrite} checked={settings.crmSync} onChange={(e) => patch({ crmSync: e.target.checked })} />
        <span>{t('settings.crmSync')}</span>
      </label>
      <p className="ui-help">{t('settings.crmSyncHelp')}</p>
      <p className="ui-help">
        <Link href="/app/books/quotes">{t('settings.quotesLink')}</Link>
      </p>
    </section>
  );
}

function Audit({ entries }: { entries: AuditEntry[] }) {
  const t = useTranslations('books');
  const date = useDate();
  return (
    <section className="panel bk-panel">
      {entries.length === 0 ? (
        <p className="ui-help">{t('settings.auditEmpty')}</p>
      ) : (
        <div className="table-wrap bk-table-wrap">
          <table className="table bk-table">
            <thead>
              <tr>
                <th scope="col">{t('settings.when')}</th>
                <th scope="col">{t('settings.who')}</th>
                <th scope="col">{t('settings.what')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((a) => (
                <tr key={a.id}>
                  <td>{date(a.createdAt, true)}</td>
                  <td className="bk-ellipsis">{a.personName ?? t('audit.system')}</td>
                  <td>
                    {t.has(`audit.${a.action.replace(/\./g, '_')}`) ? t(`audit.${a.action.replace(/\./g, '_')}`) : a.action}
                    {a.detail ? <span className="bk-rowmeta"> · {a.detail}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
