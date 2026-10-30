'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ContactDto, ItemDto } from '@/lib/books';
import type { DocSummary } from '@/lib/books-docs';
import type { ExpenseDto, PoDto, ReceiptExtraction } from '@/lib/books-purchasing';
import type { RecurringDto } from '@/lib/books-recurring';
import { formatMoney, todayIso } from '@/lib/books-money';
import { MoneyInput, StatusBadge, api, useDate, useErrorText, useToast } from './ui';

type Opt = { id: string; name: string };

// ---------- Contactos ----------

export function ContactEditor({
  contact,
  documents,
  canWrite,
  country,
  crm,
  importMode,
  baseCurrency,
}: {
  baseCurrency: string;
  contact: ContactDto | null;
  documents: DocSummary[];
  canWrite: boolean;
  country: string;
  crm: boolean;
  importMode: boolean;
}) {
  const t = useTranslations('books');
  const locale = useLocale();
  const router = useRouter();
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [f, setF] = useState({
    kind: contact?.kind ?? 'customer',
    name: contact?.name ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    country: contact?.country ?? (country === 'generic' ? '' : country),
    taxIdType: contact?.taxIdType || '',
    taxId: contact?.taxId ?? '',
    taxCondition: contact?.taxCondition ?? '',
    address: contact?.address ?? '',
    currency: contact?.currency ?? '',
    termsDays: contact?.termsDays != null ? String(contact.termsDays) : '',
    notes: contact?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [crmQ, setCrmQ] = useState('');
  const [crmList, setCrmList] = useState<Array<{ id: string; name: string; country: string; domain: string }> | null>(null);
  const [tab, setTab] = useState<'details' | 'documents'>(contact && documents.length ? 'details' : 'details');
  const typeFor = (c: string) => (c === 'AR' ? 'cuit' : c === 'MX' ? 'rfc' : c === 'BR' ? 'cnpj' : 'other');

  useEffect(() => {
    if (!importMode || !crm) return;
    const h = window.setTimeout(async () => {
      const res = await api<{ companies: Array<{ id: string; name: string; country: string; domain: string }> }>(`/api/books/contacts/crm?q=${encodeURIComponent(crmQ)}`);
      if (res.ok) setCrmList(res.data.companies);
    }, 250);
    return () => window.clearTimeout(h);
  }, [crmQ, importMode, crm]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body = {
      ...f,
      taxIdType: f.taxIdType || typeFor(f.country),
      currency: f.currency || null,
      termsDays: f.termsDays === '' ? null : Number(f.termsDays),
    };
    const res = contact
      ? await api<{ contact?: ContactDto }>(`/api/books/contacts/${contact.id}`, { method: 'PATCH', json: body })
      : await api<{ contact?: ContactDto }>('/api/books/contacts', { method: 'POST', json: body });
    setBusy(false);
    if (!res.ok || !res.data.contact) return push(errText(res.data.error), 'bad');
    push(t('common.saved'));
    if (!contact) router.replace(`/app/books/contacts/${res.data.contact.id}`);
    else router.refresh();
  };

  const importCompany = async (id: string, kind: 'customer' | 'supplier') => {
    const res = await api<{ contact?: ContactDto }>('/api/books/contacts/crm', { method: 'POST', json: { companyId: id, kind } });
    if (!res.ok || !res.data.contact) return push(errText(res.data.error), 'bad');
    router.replace(`/app/books/contacts/${res.data.contact.id}`);
  };

  const remove = async () => {
    const res = await api<{ archived?: boolean }>(`/api/books/contacts/${contact!.id}`, { method: 'DELETE' });
    setConfirm(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.replace('/app/books/contacts');
    router.refresh();
  };

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  if (importMode && !contact) {
    return (
      <div className="app-page ui-page bk-page bk-narrow">
        {toast}
        <PageHeader back={{ href: '/app/books/contacts', label: t('nav.contacts') }} title={t('contacts.importCrm')} description={t('contacts.importDesc')} />
        <div className="panel bk-panel">
          <input className="input" type="search" autoFocus value={crmQ} onChange={(e) => setCrmQ(e.target.value)} placeholder={t('contacts.searchCrm')} aria-label={t('contacts.searchCrm')} />
          {crmList == null ? (
            <p className="ui-help" aria-busy="true">
              {t('common.loading')}
            </p>
          ) : crmList.length === 0 ? (
            <p className="ui-help">{t('contacts.crmEmpty')}</p>
          ) : (
            <ul className="bk-list">
              {crmList.map((c) => (
                <li key={c.id}>
                  <span className="bk-ellipsis">{c.name}</span>
                  <span className="bk-rowmeta">{[c.domain, c.country].filter(Boolean).join(' · ')}</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => importCompany(c.id, 'customer')}>
                    {t('contacts.asCustomer')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => importCompany(c.id, 'supplier')}>
                    {t('contacts.asSupplier')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-page ui-page bk-page bk-narrow">
      {toast}
      <PageHeader
        back={{ href: '/app/books/contacts', label: t('nav.contacts') }}
        title={contact ? contact.name : t('contacts.new')}
        description={contact ? t(`contacts.kinds.${contact.kind}`) : undefined}
        actions={
          contact && canWrite ? (
            <Link className="btn btn-primary" href={`/app/books/${contact.kind === 'supplier' ? 'bills' : 'invoices'}/new?contact=${contact.id}`}>
              {contact.kind === 'supplier' ? t('docs.bill.new') : t('docs.invoice.new')}
            </Link>
          ) : undefined
        }
      />
      {contact && (
        <>
          <div className="bk-kpis">
            <div className="bk-kpi">
              <span className="bk-kpi-label">{t('contacts.receivable')}</span>
              <span className="bk-kpi-value bk-kpi-small">{formatMoney(contact.receivable ?? 0, contact.currency ?? baseCurrency, locale)}</span>
            </div>
            <div className="bk-kpi">
              <span className="bk-kpi-label">{t('contacts.payable')}</span>
              <span className="bk-kpi-value bk-kpi-small">{formatMoney(contact.payable ?? 0, contact.currency ?? baseCurrency, locale)}</span>
            </div>
          </div>
          <div className="ui-tabs bk-filter" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'details'} className="ui-tab" onClick={() => setTab('details')}>
              {t('contacts.details')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'documents'} className="ui-tab" onClick={() => setTab('documents')}>
              {t('contacts.documents', { n: documents.length })}
            </button>
          </div>
        </>
      )}
      {tab === 'documents' && contact ? (
        documents.length === 0 ? (
          <p className="ui-help">{t('contacts.noDocuments')}</p>
        ) : (
          <div className="table-wrap bk-table-wrap">
            <table className="table bk-table">
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <th scope="row">
                      <Link href={`/app/books/${d.docType === 'bill' ? 'bills' : d.docType === 'credit_note' ? 'credit-notes' : 'invoices'}/${d.id}`}>{d.reference || d.numberLabel || t('docs.untitled')}</Link>
                    </th>
                    <td className="bk-hide-sm">{date(d.issueDate)}</td>
                    <td>
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="num">{formatMoney(d.total, d.currency, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <form className="panel bk-panel" onSubmit={save}>
          <fieldset className="bk-fieldset" disabled={!canWrite}>
            <div className="bk-grid">
              <label className="ui-field">
                <span className="label">{t('contacts.name')}</span>
                <input className="input" required maxLength={160} value={f.name} onChange={set('name')} autoFocus={!contact} />
              </label>
              <label className="ui-field">
                <span className="label">{t('contacts.kind')}</span>
                <select className="select" value={f.kind} onChange={set('kind')}>
                  {['customer', 'supplier', 'both'].map((k) => (
                    <option key={k} value={k}>
                      {t(`contacts.kinds.${k}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ui-field">
                <span className="label">{t('contacts.email')}</span>
                <input className="input" type="email" value={f.email} onChange={set('email')} />
              </label>
              <label className="ui-field">
                <span className="label">{t('contacts.phone')}</span>
                <input className="input" value={f.phone} maxLength={40} onChange={set('phone')} />
              </label>
              <label className="ui-field">
                <span className="label">{t('contacts.country')}</span>
                <input className="input" value={f.country} maxLength={2} placeholder="AR" onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} />
                <span className="ui-help">{t('contacts.countryHelp')}</span>
              </label>
              <label className="ui-field">
                <span className="label">{t('contacts.taxIdType')}</span>
                <select className="select" value={f.taxIdType || typeFor(f.country)} onChange={set('taxIdType')}>
                  {['cuit', 'rfc', 'cnpj', 'cpf', 'other'].map((k) => (
                    <option key={k} value={k}>
                      {t(`contacts.taxIdTypes.${k}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ui-field">
                <span className="label">{t('contacts.taxId')}</span>
                <input className="input data" value={f.taxId} maxLength={40} onChange={set('taxId')} />
                <span className="ui-help">{t('contacts.taxIdHelp')}</span>
              </label>
              {f.country === 'AR' && (
                <label className="ui-field">
                  <span className="label">{t('contacts.taxCondition')}</span>
                  <select className="select" value={f.taxCondition} onChange={set('taxCondition')}>
                    <option value="">{t('common.none')}</option>
                    {['ri', 'monotributo', 'cf', 'exento', 'no_responsable'].map((k) => (
                      <option key={k} value={k}>
                        {t(`taxConditions.${k}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="ui-field">
                <span className="label">{t('contacts.currency')}</span>
                <input className="input" value={f.currency} maxLength={3} placeholder={t('contacts.currencyPh')} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
              </label>
              <label className="ui-field">
                <span className="label">{t('contacts.terms')}</span>
                <input className="input num" type="number" min={0} max={365} value={f.termsDays} onChange={set('termsDays')} />
              </label>
            </div>
            <label className="ui-field">
              <span className="label">{t('contacts.address')}</span>
              <textarea className="textarea" rows={2} maxLength={400} value={f.address} onChange={set('address')} />
            </label>
            <label className="ui-field">
              <span className="label">{t('contacts.notes')}</span>
              <textarea className="textarea" rows={2} maxLength={2000} value={f.notes} onChange={set('notes')} />
            </label>
            {contact?.crmCompanyId && crm && (
              <p className="ui-help">
                <Link href={`/app/crm/companies/${contact.crmCompanyId}`}>{t('contacts.openCrm')}</Link>
              </p>
            )}
          </fieldset>
          {canWrite && (
            <div className="bk-row">
              <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
                {contact ? t('common.save') : t('common.create')}
              </button>
              {contact && (
                <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
                  {t('common.delete')}
                </button>
              )}
            </div>
          )}
        </form>
      )}
      <ConfirmDialog open={confirm} title={t('contacts.deleteTitle')} body={t('contacts.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} danger onConfirm={remove} onCancel={() => setConfirm(false)} />
    </div>
  );
}

// ---------- Ítems ----------

export function ItemEditor({
  item,
  moves,
  canWrite,
  currency,
  taxes,
  accounts,
  shop,
}: {
  item: ItemDto | null;
  moves: Array<{ id: string; quantity: number; reason: string; createdAt: string }>;
  canWrite: boolean;
  currency: string;
  taxes: Opt[];
  accounts: Array<{ id: string; name: string; type: string }>;
  shop: boolean;
}) {
  const t = useTranslations('books');
  const router = useRouter();
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [f, setF] = useState({
    kind: item?.kind ?? 'service',
    name: item?.name ?? '',
    sku: item?.sku ?? '',
    description: item?.description ?? '',
    unit: item?.unit ?? '',
    price: item?.price ?? (null as number | null),
    cost: item?.cost ?? (null as number | null),
    taxRateId: item?.taxRateId ?? '',
    salesAccountId: item?.salesAccountId ?? '',
    purchaseAccountId: item?.purchaseAccountId ?? '',
    trackStock: item?.trackStock ?? false,
  });
  const [variantQ, setVariantQ] = useState('');
  const [variants, setVariants] = useState<Array<{ id: string; product: string; variant: string; sku: string }>>([]);
  const [adjust, setAdjust] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!shop || !item || item.shopVariantId) return;
    const h = window.setTimeout(async () => {
      const res = await api<{ variants: Array<{ id: string; product: string; variant: string; sku: string }> }>(`/api/books/items/shop-variants?q=${encodeURIComponent(variantQ)}`);
      if (res.ok) setVariants(res.data.variants);
    }, 250);
    return () => window.clearTimeout(h);
  }, [variantQ, shop, item]);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    const res = item ? await api<{ item?: ItemDto }>(`/api/books/items/${item.id}`, { method: 'PATCH', json: body }) : await api<{ item?: ItemDto }>('/api/books/items', { method: 'POST', json: body });
    setBusy(false);
    if (!res.ok || !res.data.item) {
      push(errText(res.data.error), 'bad');
      return null;
    }
    return res.data.item;
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const out = await patch({
      ...f,
      price: f.price ?? 0,
      cost: f.cost ?? 0,
      taxRateId: f.taxRateId || null,
      salesAccountId: f.salesAccountId || null,
      purchaseAccountId: f.purchaseAccountId || null,
    });
    if (!out) return;
    push(t('common.saved'));
    if (!item) router.replace(`/app/books/items/${out.id}`);
    else router.refresh();
  };

  const link = async (variantId: string | null) => {
    if (await patch({ shopVariantId: variantId })) router.refresh();
  };

  const doAdjust = async (e: FormEvent) => {
    e.preventDefault();
    const q = Number(adjust.replace(',', '.'));
    if (!q) return;
    const res = await api(`/api/books/items/${item!.id}/stock`, { method: 'POST', json: { quantity: q } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setAdjust('');
    router.refresh();
  };

  const remove = async () => {
    const res = await api(`/api/books/items/${item!.id}`, { method: 'DELETE' });
    setConfirm(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.replace('/app/books/items');
    router.refresh();
  };

  return (
    <div className="app-page ui-page bk-page bk-narrow">
      {toast}
      <PageHeader back={{ href: '/app/books/items', label: t('nav.items') }} title={item ? item.name : t('items.new')} />
      <form className="panel bk-panel" onSubmit={save}>
        <fieldset className="bk-fieldset" disabled={!canWrite}>
          <div className="bk-grid">
            <label className="ui-field">
              <span className="label">{t('items.name')}</span>
              <input className="input" required maxLength={160} autoFocus={!item} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </label>
            <label className="ui-field">
              <span className="label">{t('items.kind')}</span>
              <select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'product' | 'service', trackStock: e.target.value === 'product' ? f.trackStock : false })}>
                <option value="service">{t('items.kinds.service')}</option>
                <option value="product">{t('items.kinds.product')}</option>
              </select>
            </label>
            <label className="ui-field">
              <span className="label">{t('items.sku')}</span>
              <input className="input data" maxLength={60} value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />
            </label>
            <label className="ui-field">
              <span className="label">{t('items.unit')}</span>
              <input className="input" maxLength={20} value={f.unit} placeholder={t('items.unitPh')} onChange={(e) => setF({ ...f, unit: e.target.value })} />
            </label>
            <label className="ui-field">
              <span className="label">{t('items.price', { currency })}</span>
              <MoneyInput value={f.price} onChange={(v) => setF({ ...f, price: v })} currency={currency} label={t('items.price', { currency })} />
            </label>
            <label className="ui-field">
              <span className="label">{t('items.cost', { currency })}</span>
              <MoneyInput value={f.cost} onChange={(v) => setF({ ...f, cost: v })} currency={currency} label={t('items.cost', { currency })} />
            </label>
            <label className="ui-field">
              <span className="label">{t('items.tax')}</span>
              <select className="select" value={f.taxRateId} onChange={(e) => setF({ ...f, taxRateId: e.target.value })}>
                <option value="">{t('editor.noTax')}</option>
                {taxes.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="label">{t('items.salesAccount')}</span>
              <select className="select" value={f.salesAccountId} onChange={(e) => setF({ ...f, salesAccountId: e.target.value })}>
                <option value="">{t('items.defaultAccount')}</option>
                {accounts
                  .filter((a) => a.type === 'income')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="label">{t('items.purchaseAccount')}</span>
              <select className="select" value={f.purchaseAccountId} onChange={(e) => setF({ ...f, purchaseAccountId: e.target.value })}>
                <option value="">{t('items.defaultAccount')}</option>
                {accounts
                  .filter((a) => a.type === 'expense' || a.type === 'asset')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label className="ui-field">
            <span className="label">{t('items.description')}</span>
            <textarea className="textarea" rows={2} maxLength={2000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </label>
          {f.kind === 'product' && !item?.shopVariantId && (
            <label className="ui-check">
              <input type="checkbox" checked={f.trackStock} onChange={(e) => setF({ ...f, trackStock: e.target.checked })} />
              <span>{t('items.trackStock')}</span>
            </label>
          )}
        </fieldset>
        {canWrite && (
          <div className="bk-row">
            <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
              {item ? t('common.save') : t('common.create')}
            </button>
            {item && (
              <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
                {t('common.delete')}
              </button>
            )}
          </div>
        )}
      </form>
      {item && (
        <section className="panel bk-panel">
          <h2 className="bk-panel-title">{t('items.stock')}</h2>
          {item.shopLinked ? (
            <>
              <p>{t('items.shopLinked', { product: item.shopLinked.product, variant: item.shopLinked.variant, n: item.stock })}</p>
              {canWrite && (
                <div className="bk-row">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => link(null)}>
                    {t('items.unlinkShop')}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {item.trackStock && <p className="bk-kpi-value">{item.stock}</p>}
              {canWrite && item.trackStock && (
                <form className="bk-row" onSubmit={doAdjust}>
                  <input className="input num bk-cell-xs" inputMode="decimal" aria-label={t('items.adjustLabel')} placeholder="+10 / -2" value={adjust} onChange={(e) => setAdjust(e.target.value)} />
                  <button type="submit" className="btn btn-secondary btn-sm">
                    {t('items.adjust')}
                  </button>
                </form>
              )}
              {shop && canWrite && (
                <div className="bk-shop-link">
                  <p className="ui-help">{t('items.linkShopHelp')}</p>
                  <input className="input" type="search" value={variantQ} onChange={(e) => setVariantQ(e.target.value)} placeholder={t('items.searchShop')} aria-label={t('items.searchShop')} />
                  {variants.length > 0 && (
                    <ul className="bk-list">
                      {variants.map((v) => (
                        <li key={v.id}>
                          <span className="bk-ellipsis">
                            {v.product}
                            {v.variant && v.variant !== 'Default' ? ` (${v.variant})` : ''}
                          </span>
                          <span className="bk-rowmeta data">{v.sku}</span>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => link(v.id)}>
                            {t('items.link')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
          {moves.length > 0 && (
            <ul className="bk-list">
              {moves.map((m) => (
                <li key={m.id}>
                  <span>{date(m.createdAt, true)}</span>
                  <span>{t.has(`items.reasons.${m.reason}`) ? t(`items.reasons.${m.reason}`) : m.reason}</span>
                  <span className="data">{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <ConfirmDialog open={confirm} title={t('items.deleteTitle')} body={t('items.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} danger onConfirm={remove} onCancel={() => setConfirm(false)} />
    </div>
  );
}

// ---------- Gastos ----------

export function ExpenseEditor({
  expense,
  canWrite,
  baseCurrency,
  taxes,
  accounts,
  banks,
  suppliers,
  aiEnabled,
}: {
  expense: ExpenseDto | null;
  canWrite: boolean;
  baseCurrency: string;
  taxes: Opt[];
  accounts: Opt[];
  banks: Opt[];
  suppliers: Opt[];
  aiEnabled: boolean;
}) {
  const t = useTranslations('books');
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const editable = canWrite && (!expense || expense.status === 'draft');
  const [f, setF] = useState({
    date: expense?.date ?? todayIso(),
    vendor: expense?.vendor ?? '',
    contactId: expense?.contactId ?? '',
    description: expense?.description ?? '',
    accountId: expense?.accountId ?? '',
    paidFromId: expense?.paidFromId ?? banks[0]?.id ?? '',
    currency: expense?.currency ?? baseCurrency,
    fxRate: expense && expense.fxRate !== '1' ? expense.fxRate : '',
    total: expense?.total ?? (null as number | null),
    taxRateId: expense?.taxRateId ?? '',
    tax: expense ? (expense.tax as number | null) : null,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'void' | null>(null);
  const [ai, setAi] = useState<ReceiptExtraction | null>(null);

  const body = () => ({
    date: f.date,
    vendor: f.vendor,
    contactId: f.contactId || null,
    description: f.description,
    accountId: f.accountId || null,
    paidFromId: f.paidFromId || null,
    currency: f.currency,
    ...(f.currency !== baseCurrency ? { fxRate: f.fxRate } : {}),
    total: f.total ?? 0,
    taxRateId: f.taxRateId || null,
    tax: f.tax,
  });

  const save = async (): Promise<string | null> => {
    const res = expense
      ? await api<{ expense?: ExpenseDto }>(`/api/books/expenses/${expense.id}`, { method: 'PATCH', json: body() })
      : await api<{ expense?: ExpenseDto }>('/api/books/expenses', { method: 'POST', json: body() });
    if (!res.ok || !res.data.expense) {
      push(errText(res.data.error), 'bad');
      return null;
    }
    return res.data.expense.id;
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    const id = await save();
    setBusy(null);
    if (!id) return;
    push(t('common.saved'));
    if (!expense) router.replace(`/app/books/expenses/${id}`);
    else router.refresh();
  };

  const onPost = async () => {
    setBusy('post');
    const id = await save();
    if (!id) return setBusy(null);
    const res = await api(`/api/books/expenses/${id}/post`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(t('expenses.posted'));
    if (!expense) router.replace(`/app/books/expenses/${id}`);
    else router.refresh();
  };

  const upload = async (file: File) => {
    let id = expense?.id ?? null;
    if (!id) id = await save();
    if (!id) return;
    setBusy('upload');
    const form = new FormData();
    form.set('file', file);
    const res = await api(`/api/books/expenses/${id}/receipt`, { method: 'POST', body: form });
    setBusy(null);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(t('expenses.receiptSaved'));
    if (!expense) router.replace(`/app/books/expenses/${id}`);
    else router.refresh();
  };

  const extract = async () => {
    if (!expense) return;
    setBusy('ai');
    const res = await api<{ extraction?: ReceiptExtraction }>(`/api/books/expenses/${expense.id}/extract`, { method: 'POST' });
    setBusy(null);
    if (!res.ok || !res.data.extraction) return push(errText(res.data.error), 'bad');
    const x = res.data.extraction;
    setAi(x);
    // Propone en el formulario: la persona revisa y guarda.
    setF((cur) => ({
      ...cur,
      vendor: x.vendor || cur.vendor,
      date: x.date ?? cur.date,
      total: x.total ?? cur.total,
      tax: x.tax ?? cur.tax,
      currency: x.currency ?? cur.currency,
    }));
    push(t('expenses.aiFilled'));
  };

  const act = async (path: 'void') => {
    const res = await api(`/api/books/expenses/${expense!.id}/${path}`, { method: 'POST' });
    setConfirm(null);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.refresh();
  };

  const remove = async () => {
    const res = await api(`/api/books/expenses/${expense!.id}`, { method: 'DELETE' });
    setConfirm(null);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.replace('/app/books/expenses');
    router.refresh();
  };

  const receiptUrl = expense?.hasReceipt ? `/api/books/expenses/${expense.id}/receipt?v=${encodeURIComponent(expense.updatedAt)}` : null;

  return (
    <div className="app-page ui-page bk-page">
      {toast}
      <PageHeader
        back={{ href: '/app/books/expenses', label: t('nav.expenses') }}
        title={expense ? expense.vendor || expense.description || t('expenses.untitled') : t('expenses.new')}
        description={expense ? undefined : t('expenses.newDesc')}
        actions={expense ? <StatusBadge status={expense.status} /> : undefined}
      />
      <div className="bk-editor">
        <form className="bk-editor-main" onSubmit={onSave}>
          <section className="panel bk-panel">
            <fieldset className="bk-fieldset" disabled={!editable}>
              <div className="bk-grid">
                <label className="ui-field">
                  <span className="label">{t('expenses.vendor')}</span>
                  <input className="input" maxLength={160} autoFocus={!expense} value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} />
                </label>
                <label className="ui-field">
                  <span className="label">{t('expenses.supplier')}</span>
                  <select className="select" value={f.contactId} onChange={(e) => setF({ ...f, contactId: e.target.value })}>
                    <option value="">{t('common.none')}</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ui-field">
                  <span className="label">{t('expenses.date')}</span>
                  <input className="input" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
                </label>
                <label className="ui-field">
                  <span className="label">{t('expenses.category')}</span>
                  <select className="select" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
                    <option value="">{t('expenses.defaultCategory')}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ui-field">
                  <span className="label">{t('expenses.paidFrom')}</span>
                  <select className="select" value={f.paidFromId} onChange={(e) => setF({ ...f, paidFromId: e.target.value })}>
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ui-field">
                  <span className="label">{t('editor.currency')}</span>
                  <input className="input" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
                </label>
                {f.currency !== baseCurrency && (
                  <label className="ui-field">
                    <span className="label">{t('editor.fxRate', { base: baseCurrency, cur: f.currency })}</span>
                    <input className="input num" inputMode="decimal" required value={f.fxRate} onChange={(e) => setF({ ...f, fxRate: e.target.value })} />
                  </label>
                )}
                <label className="ui-field">
                  <span className="label">{t('expenses.total')}</span>
                  <MoneyInput value={f.total} onChange={(v) => setF({ ...f, total: v })} currency={f.currency} label={t('expenses.total')} required />
                </label>
                <label className="ui-field">
                  <span className="label">{t('expenses.taxRate')}</span>
                  <select className="select" value={f.taxRateId} onChange={(e) => setF({ ...f, taxRateId: e.target.value, tax: null })}>
                    <option value="">{t('editor.noTax')}</option>
                    {taxes.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ui-field">
                  <span className="label">{t('expenses.tax')}</span>
                  <MoneyInput value={f.tax} onChange={(v) => setF({ ...f, tax: v })} currency={f.currency} label={t('expenses.tax')} />
                  <span className="ui-help">{t('expenses.taxHelp')}</span>
                </label>
              </div>
              <label className="ui-field">
                <span className="label">{t('expenses.description')}</span>
                <input className="input" maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
              </label>
            </fieldset>
            {editable && (
              <div className="bk-row">
                <button type="submit" className="btn btn-secondary" disabled={!!busy} aria-busy={busy === 'save'}>
                  {t('editor.saveDraft')}
                </button>
                <button type="button" className="btn btn-primary" disabled={!!busy || !f.total} aria-busy={busy === 'post'} onClick={onPost}>
                  {t('expenses.post')}
                </button>
                {expense && (
                  <button type="button" className="btn btn-danger" onClick={() => setConfirm('delete')}>
                    {t('common.delete')}
                  </button>
                )}
              </div>
            )}
            {canWrite && expense?.status === 'posted' && (
              <div className="bk-row">
                <button type="button" className="btn btn-danger" onClick={() => setConfirm('void')}>
                  {t('editor.void')}
                </button>
              </div>
            )}
          </section>
        </form>
        <aside className="bk-editor-side">
          <section className="panel bk-panel">
            <h2 className="bk-panel-title">{t('expenses.receipt')}</h2>
            {receiptUrl ? (
              expense?.receiptMime === 'application/pdf' ? (
                <a href={receiptUrl} target="_blank" rel="noreferrer">
                  {expense.receiptName ?? t('expenses.openReceipt')}
                </a>
              ) : (
                <a href={receiptUrl} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="bk-receipt" src={receiptUrl} alt={t('expenses.receipt')} />
                </a>
              )
            ) : (
              <p className="ui-help">{t('expenses.noReceipt')}</p>
            )}
            {editable && (
              <label className="btn btn-secondary btn-sm bk-file">
                {busy === 'upload' ? t('common.loading') : expense?.hasReceipt ? t('expenses.replaceReceipt') : t('expenses.uploadReceipt')}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
            <p className="ui-help">{t('expenses.receiptHelp')}</p>
            {editable && expense?.hasReceipt && aiEnabled && (
              <>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy === 'ai'} aria-busy={busy === 'ai'} onClick={extract}>
                  {t('expenses.readAi')}
                </button>
                <p className="ui-help">{t('expenses.aiHelp')}</p>
              </>
            )}
            {(ai ?? expense?.ai) && <p className="ui-help">{t('expenses.aiNote', { vendor: (ai ?? expense?.ai)?.vendor || '-' })}</p>}
          </section>
        </aside>
      </div>
      <ConfirmDialog open={confirm === 'delete'} title={t('expenses.deleteTitle')} body={t('expenses.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} danger onConfirm={remove} onCancel={() => setConfirm(null)} />
      <ConfirmDialog open={confirm === 'void'} title={t('editor.voidTitle')} body={t('expenses.voidBody')} confirmLabel={t('editor.void')} cancelLabel={t('common.cancel')} danger onConfirm={() => act('void')} onCancel={() => setConfirm(null)} />
    </div>
  );
}

// ---------- Órdenes de compra ----------

interface PoLineState {
  key: number;
  itemId: string;
  description: string;
  quantity: string;
  unitCost: number | null;
  taxRateId: string;
}
let poSeq = 0;

export function PurchaseOrderEditor({
  order,
  canWrite,
  baseCurrency,
  suppliers,
  items,
  taxes,
}: {
  order: PoDto | null;
  canWrite: boolean;
  baseCurrency: string;
  suppliers: Opt[];
  items: Array<{ id: string; name: string; cost: number; taxRateId: string | null }>;
  taxes: Opt[];
}) {
  const t = useTranslations('books');
  const locale = useLocale();
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const editable = canWrite && (!order || order.status === 'draft' || order.status === 'sent');
  const [contactId, setContactId] = useState(order?.contactId ?? '');
  const [issueDate, setIssueDate] = useState(order?.issueDate ?? todayIso());
  const [expectedDate, setExpectedDate] = useState(order?.expectedDate ?? '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const currency = order?.currency ?? baseCurrency;
  const [lines, setLines] = useState<PoLineState[]>(() =>
    order?.lines.length
      ? order.lines.map((l) => ({ key: ++poSeq, itemId: l.itemId ?? '', description: l.description, quantity: String(l.quantity), unitCost: l.unitCost, taxRateId: l.taxRateId ?? '' }))
      : [{ key: ++poSeq, itemId: '', description: '', quantity: '1', unitCost: null, taxRateId: '' }],
  );
  const [receive, setReceive] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'cancel' | null>(null);
  const money = (v: number) => formatMoney(v, currency, locale);
  const setLine = (key: number, p: Partial<PoLineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    const body = {
      contactId: contactId || null,
      issueDate,
      expectedDate: expectedDate || null,
      notes,
      lines: lines
        .filter((l) => l.description.trim() || l.itemId)
        .map((l) => ({ itemId: l.itemId || null, description: l.description, quantity: Number(l.quantity.replace(',', '.')) || 0, unitCost: l.unitCost ?? 0, taxRateId: l.taxRateId || null })),
    };
    const res = order
      ? await api<{ order?: PoDto }>(`/api/books/purchase-orders/${order.id}`, { method: 'PATCH', json: body })
      : await api<{ order?: PoDto }>('/api/books/purchase-orders', { method: 'POST', json: body });
    setBusy(null);
    if (!res.ok || !res.data.order) return push(errText(res.data.error), 'bad');
    push(t('common.saved'));
    if (!order) router.replace(`/app/books/purchase-orders/${res.data.order.id}`);
    else router.refresh();
  };

  const post = async (path: string, json: unknown, after?: (d: Record<string, unknown>) => void) => {
    setBusy(path);
    const res = await api<Record<string, unknown>>(`/api/books/purchase-orders/${order!.id}${path}`, { method: path === '' ? 'PATCH' : 'POST', json });
    setBusy(null);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    if (after) after(res.data);
    else router.refresh();
  };

  const remove = async () => {
    const res = await api(`/api/books/purchase-orders/${order!.id}`, { method: 'DELETE' });
    setConfirm(null);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.replace('/app/books/purchase-orders');
    router.refresh();
  };

  const pending = order?.lines.filter((l) => l.receivedQty < l.quantity) ?? [];

  return (
    <div className="app-page ui-page bk-page">
      {toast}
      <PageHeader
        back={{ href: '/app/books/purchase-orders', label: t('nav.purchaseOrders') }}
        title={order ? order.label : t('po.new')}
        description={order?.contactName}
        actions={order ? <StatusBadge status={order.status} /> : undefined}
      />
      <form className="panel bk-panel" onSubmit={save}>
        <fieldset className="bk-fieldset" disabled={!editable}>
          <div className="bk-grid">
            <label className="ui-field">
              <span className="label">{t('editor.supplier')}</span>
              <select className="select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">{t('editor.pickContact')}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="label">{t('editor.issueDate')}</span>
              <input className="input" type="date" required value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </label>
            <label className="ui-field">
              <span className="label">{t('po.expected')}</span>
              <input className="input" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </label>
          </div>
          <div className="bk-table-wrap">
            <table className="table bk-table bk-lines">
              <thead>
                <tr>
                  <th scope="col">{t('editor.colItem')}</th>
                  <th scope="col">{t('editor.colDescription')}</th>
                  <th scope="col" className="num">
                    {t('editor.colQty')}
                  </th>
                  <th scope="col" className="num">
                    {t('po.unitCost')}
                  </th>
                  <th scope="col">{t('editor.colTax')}</th>
                  {order && (
                    <th scope="col" className="num">
                      {t('po.received')}
                    </th>
                  )}
                  <th scope="col">
                    <span className="sr-only">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.key}>
                    <td>
                      <select
                        className="select bk-cell"
                        aria-label={t('editor.colItem')}
                        value={l.itemId}
                        onChange={(e) => {
                          const it = items.find((x) => x.id === e.target.value);
                          setLine(l.key, it ? { itemId: it.id, description: it.name, unitCost: it.cost, taxRateId: it.taxRateId ?? '' } : { itemId: '' });
                        }}
                      >
                        <option value="">{t('editor.noItem')}</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className="input bk-cell bk-cell-wide" aria-label={t('editor.colDescription')} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} />
                    </td>
                    <td>
                      <input className="input num bk-cell bk-cell-xs" inputMode="decimal" aria-label={t('editor.colQty')} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                    </td>
                    <td>
                      <MoneyInput value={l.unitCost} onChange={(v) => setLine(l.key, { unitCost: v })} currency={currency} label={t('po.unitCost')} />
                    </td>
                    <td>
                      <select className="select bk-cell" aria-label={t('editor.colTax')} value={l.taxRateId} onChange={(e) => setLine(l.key, { taxRateId: e.target.value })}>
                        <option value="">{t('editor.noTax')}</option>
                        {taxes.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    {order && <td className="num">{order.lines[i]?.receivedQty ?? 0}</td>}
                    <td>
                      <button type="button" className="btn btn-ghost btn-sm" aria-label={t('editor.removeLine')} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, { key: ++poSeq, itemId: '', description: '', quantity: '1', unitCost: null, taxRateId: '' }])}>
              {t('editor.addLine')}
            </button>
          </div>
          <label className="ui-field">
            <span className="label">{t('editor.notes')}</span>
            <textarea className="textarea" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </fieldset>
        {order && <p className="data">{t('po.total', { total: money(order.total) })}</p>}
        {editable && (
          <div className="bk-row">
            <button type="submit" className="btn btn-primary" disabled={!!busy} aria-busy={busy === 'save'}>
              {order ? t('common.save') : t('common.create')}
            </button>
            {order?.status === 'draft' && (
              <button type="button" className="btn btn-secondary" onClick={() => post('', { status: 'sent' })}>
                {t('po.markSent')}
              </button>
            )}
            {order && (
              <button type="button" className="btn btn-danger" onClick={() => setConfirm(order.status === 'draft' ? 'delete' : 'cancel')}>
                {order.status === 'draft' ? t('common.delete') : t('po.cancel')}
              </button>
            )}
          </div>
        )}
      </form>
      {order && canWrite && ['draft', 'sent', 'partial'].includes(order.status) && pending.length > 0 && (
        <form
          className="panel bk-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void post('/receive', { lines: Object.entries(receive).map(([lineId, q]) => ({ lineId, quantity: Number(q.replace(',', '.')) || 0 })).filter((l) => l.quantity > 0) }, () => {
              setReceive({});
              router.refresh();
            });
          }}
        >
          <h2 className="bk-panel-title">{t('po.receiveTitle')}</h2>
          <ul className="bk-list">
            {pending.map((l) => (
              <li key={l.id}>
                <span className="bk-ellipsis">{l.description}</span>
                <span className="bk-rowmeta">{t('po.pending', { n: l.quantity - l.receivedQty })}</span>
                <input className="input num bk-cell-xs" inputMode="decimal" aria-label={t('po.receiveQty', { item: l.description })} value={receive[l.id] ?? ''} onChange={(e) => setReceive({ ...receive, [l.id]: e.target.value })} />
              </li>
            ))}
          </ul>
          <div className="bk-row">
            <button type="submit" className="btn btn-secondary" disabled={busy === '/receive'}>
              {t('po.receive')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setReceive(Object.fromEntries(pending.map((l) => [l.id, String(l.quantity - l.receivedQty)])))}>
              {t('po.receiveAll')}
            </button>
          </div>
          <p className="ui-help">{t('po.receiveHelp')}</p>
        </form>
      )}
      {order && canWrite && order.status !== 'cancelled' && (
        <section className="panel bk-panel">
          <h2 className="bk-panel-title">{t('po.billTitle')}</h2>
          {order.billId ? (
            <Link href={`/app/books/bills/${order.billId}`}>{t('po.openBill')}</Link>
          ) : (
            <div className="bk-row">
              <button type="button" className="btn btn-secondary" onClick={() => post('/bill', {}, (d) => router.push(`/app/books/bills/${(d.doc as { id: string }).id}`))}>
                {t('po.billOrdered')}
              </button>
              {order.lines.some((l) => l.receivedQty > 0) && (
                <button type="button" className="btn btn-ghost" onClick={() => post('/bill', { received: true }, (d) => router.push(`/app/books/bills/${(d.doc as { id: string }).id}`))}>
                  {t('po.billReceived')}
                </button>
              )}
            </div>
          )}
        </section>
      )}
      <ConfirmDialog open={confirm === 'delete'} title={t('po.deleteTitle')} body={t('po.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} danger onConfirm={remove} onCancel={() => setConfirm(null)} />
      <ConfirmDialog
        open={confirm === 'cancel'}
        title={t('po.cancelTitle')}
        body={t('po.cancelBody')}
        confirmLabel={t('po.cancel')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => {
          setConfirm(null);
          void post('', { status: 'cancelled' });
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

// ---------- Recurrentes ----------

export function RecurringEditor({
  rec,
  documents,
  canWrite,
  baseCurrency,
  customers,
  items,
  taxes,
}: {
  rec: RecurringDto | null;
  documents: DocSummary[];
  canWrite: boolean;
  baseCurrency: string;
  customers: Opt[];
  items: Array<{ id: string; name: string; price: number; taxRateId: string | null }>;
  taxes: Opt[];
}) {
  const t = useTranslations('books');
  const locale = useLocale();
  const router = useRouter();
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [name, setName] = useState(rec?.name ?? '');
  const [contactId, setContactId] = useState(rec?.contactId ?? '');
  const [frequency, setFrequency] = useState<string>(rec?.frequency ?? 'monthly');
  const [interval, setInterval] = useState(String(rec?.interval ?? 1));
  const [nextDate, setNextDate] = useState(rec?.nextDate ?? todayIso());
  const [endDate, setEndDate] = useState(rec?.endDate ?? '');
  const [autoSend, setAutoSend] = useState(rec?.autoSend ?? false);
  const [currency, setCurrency] = useState(rec?.template.currency ?? baseCurrency);
  const [fxRate, setFxRate] = useState(rec?.template.fxRate ?? '');
  type RecLine = { key: string; itemId: string; description: string; quantity: string; unitPrice: number | null; discount: string; taxRateId: string };
  const blankLine = (): RecLine => ({ key: Math.random().toString(36).slice(2), itemId: '', description: '', quantity: '1', unitPrice: null, discount: '', taxRateId: '' });
  const [lines, setLines] = useState<RecLine[]>(() => {
    const src = rec?.template.lines ?? [];
    if (!src.length) return [blankLine()];
    return src.map((l) => ({
      key: Math.random().toString(36).slice(2),
      itemId: l.itemId ?? '',
      description: l.description ?? '',
      quantity: String(l.quantity ?? 1),
      unitPrice: typeof l.unitPrice === 'number' ? l.unitPrice : null,
      discount: l.discountBps ? String(l.discountBps / 100) : '',
      taxRateId: l.taxRateId ?? '',
    }));
  });
  const setLine = (key: string, patch: Partial<RecLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body = {
      name,
      contactId,
      frequency,
      interval: Number(interval) || 1,
      nextDate,
      endDate: endDate || null,
      autoSend,
      template: {
        ...(rec?.template ?? {}),
        currency,
        fxRate: currency === baseCurrency ? undefined : fxRate,
        lines: lines.map((l) => ({
          itemId: l.itemId || null,
          description: l.description,
          quantity: Number(l.quantity.replace(',', '.')) || 1,
          unitPrice: l.unitPrice ?? 0,
          discountBps: Math.round((Number(l.discount.replace(',', '.')) || 0) * 100),
          taxRateId: l.taxRateId || null,
        })),
      },
    };
    const res = rec
      ? await api<{ recurring?: RecurringDto }>(`/api/books/recurring/${rec.id}`, { method: 'PATCH', json: body })
      : await api<{ recurring?: RecurringDto }>('/api/books/recurring', { method: 'POST', json: body });
    setBusy(false);
    if (!res.ok || !res.data.recurring) return push(errText(res.data.error), 'bad');
    push(t('common.saved'));
    if (!rec) router.replace(`/app/books/recurring/${res.data.recurring.id}`);
    else router.refresh();
  };

  const toggle = async () => {
    const res = await api(`/api/books/recurring/${rec!.id}`, { method: 'PATCH', json: { status: rec!.status === 'active' ? 'paused' : 'active' } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.refresh();
  };

  const remove = async () => {
    const res = await api(`/api/books/recurring/${rec!.id}`, { method: 'DELETE' });
    setConfirm(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.replace('/app/books/recurring');
    router.refresh();
  };

  return (
    <div className="app-page ui-page bk-page bk-narrow">
      {toast}
      <PageHeader back={{ href: '/app/books/recurring', label: t('nav.recurring') }} title={rec ? rec.name : t('recurring.new')} actions={rec ? <StatusBadge status={rec.status} /> : undefined} />
      <form className="panel bk-panel" onSubmit={save}>
        <fieldset className="bk-fieldset" disabled={!canWrite}>
          <div className="bk-grid">
            <label className="ui-field">
              <span className="label">{t('recurring.name')}</span>
              <input className="input" required maxLength={120} autoFocus={!rec} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('recurring.namePh')} />
            </label>
            <label className="ui-field">
              <span className="label">{t('editor.customer')}</span>
              <select className="select" required value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">{t('editor.pickContact')}</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="label">{t('recurring.frequency')}</span>
              <select className="select" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                {['weekly', 'monthly', 'quarterly', 'yearly'].map((k) => (
                  <option key={k} value={k}>
                    {t(`recurring.freq.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="label">{t('recurring.every')}</span>
              <input className="input num" type="number" min={1} max={12} value={interval} onChange={(e) => setInterval(e.target.value)} />
            </label>
            <label className="ui-field">
              <span className="label">{t('recurring.next')}</span>
              <input className="input" type="date" required value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
            </label>
            <label className="ui-field">
              <span className="label">{t('recurring.end')}</span>
              <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </div>
          <div className="bk-grid">
            <label className="ui-field">
              <span className="label">{t('editor.currency')}</span>
              <input className="input" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </label>
            {currency !== baseCurrency && (
              <label className="ui-field">
                <span className="label">{t('editor.fxRate', { base: baseCurrency, cur: currency })}</span>
                <input className="input num" inputMode="decimal" required value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
              </label>
            )}
          </div>
          <h2 className="bk-panel-title">{t('editor.lines')}</h2>
          {lines.map((l, i) => (
            <div key={l.key} className="bk-grid bk-rec-line">
              <label className="ui-field">
                <span className="label">{t('editor.colItem')}</span>
                <select
                  className="select"
                  value={l.itemId}
                  onChange={(e) => {
                    const it = items.find((x) => x.id === e.target.value);
                    setLine(l.key, it ? { itemId: it.id, description: it.name, unitPrice: it.price, taxRateId: it.taxRateId ?? '' } : { itemId: '' });
                  }}
                >
                  <option value="">{t('editor.noItem')}</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ui-field">
                <span className="label">{t('editor.colDescription')}</span>
                <input className="input" required value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} />
              </label>
              <label className="ui-field">
                <span className="label">{t('editor.colQty')}</span>
                <input className="input num" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
              </label>
              <label className="ui-field">
                <span className="label">{t('editor.colPrice')}</span>
                <MoneyInput value={l.unitPrice} onChange={(v) => setLine(l.key, { unitPrice: v })} currency={currency} label={t('editor.colPrice')} required />
              </label>
              <label className="ui-field">
                <span className="label">{t('editor.colDiscount')}</span>
                <input className="input num" inputMode="decimal" placeholder="0" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} />
              </label>
              <label className="ui-field">
                <span className="label">{t('editor.colTax')}</span>
                <select className="select" value={l.taxRateId} onChange={(e) => setLine(l.key, { taxRateId: e.target.value })}>
                  <option value="">{t('editor.noTax')}</option>
                  {taxes.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              {lines.length > 1 && (
                <div>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`${t('editor.removeLine')} ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    {t('editor.removeLine')}
                  </button>
                </div>
              )}
            </div>
          ))}
          <div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, blankLine()])}>
              {t('editor.addLine')}
            </button>
          </div>
          <label className="ui-check">
            <input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} />
            <span>{t('recurring.autoSend')}</span>
          </label>
          <p className="ui-help">{t('recurring.help')}</p>
        </fieldset>
        {canWrite && (
          <div className="bk-row">
            <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
              {rec ? t('common.save') : t('common.create')}
            </button>
            {rec && rec.status !== 'ended' && (
              <button type="button" className="btn btn-secondary" onClick={toggle}>
                {rec.status === 'active' ? t('recurring.pause') : t('recurring.resume')}
              </button>
            )}
            {rec && (
              <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
                {t('common.delete')}
              </button>
            )}
          </div>
        )}
      </form>
      {rec && (
        <section className="panel bk-panel">
          <h2 className="bk-panel-title">{t('recurring.generated')}</h2>
          {documents.length === 0 ? (
            <p className="ui-help">{t('recurring.noneYet')}</p>
          ) : (
            <ul className="bk-list">
              {documents.map((d) => (
                <li key={d.id}>
                  <Link href={`/app/books/invoices/${d.id}`}>{d.numberLabel || d.reference}</Link>
                  <span>{date(d.issueDate)}</span>
                  <StatusBadge status={d.status} />
                  <span className="data">{formatMoney(d.total, d.currency, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <ConfirmDialog open={confirm} title={t('recurring.deleteTitle')} body={t('recurring.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} danger onConfirm={remove} onCancel={() => setConfirm(false)} />
    </div>
  );
}
