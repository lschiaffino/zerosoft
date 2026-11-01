'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { OrderDto } from '@/lib/shop-orders';
import { MoneyInput, api, useErrorText, useMoney, useToast } from './shop-ui';

export interface CatalogEntry {
  variantId: string;
  title: string;
  variantTitle: string;
  sku: string;
  priceCents: number;
  /** null = no se controla o se sigue vendiendo sin stock. */
  stock: number | null;
}

type Line = { key: string; variantId: string | null; title: string; variantTitle: string; priceCents: number; quantity: number; stock: number | null };

let seq = 0;
const nextKey = () => `l${++seq}`;

/** Pedido armado por el equipo: productos o ítems sueltos, cliente y total. Se guarda como borrador, se factura o se marca pagado. */
export default function DraftEditor({ draft, from, currency, catalog }: { draft: OrderDto | null; from: OrderDto | null; currency: string; catalog: CatalogEntry[] }) {
  const t = useTranslations('shop');
  const router = useRouter();
  const money = useMoney(currency);
  const errText = useErrorText();
  const [toast, push] = useToast();
  const base = draft ?? from;
  const [email, setEmail] = useState(base?.email ?? '');
  const [name, setName] = useState(base?.name ?? '');
  const [phone, setPhone] = useState(base?.phone ?? '');
  const [lines, setLines] = useState<Line[]>(
    (draft?.items ?? []).map((i) => ({ key: nextKey(), variantId: i.variantId, title: i.title, variantTitle: i.variantTitle, priceCents: i.unitCents, quantity: i.quantity, stock: catalog.find((c) => c.variantId === i.variantId)?.stock ?? null })),
  );
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState<{ title: string; price: number | null } | null>(null);
  const [shippingName, setShippingName] = useState(draft?.shippingName ?? '');
  const [shipping, setShipping] = useState<number | null>(draft?.shippingCents || null);
  const [discount, setDiscount] = useState<number | null>(draft?.discountCents || null);
  const [note, setNote] = useState(draft?.note ?? '');
  const a = base?.shippingAddress ?? null;
  const [addr, setAddr] = useState({ name: a?.name ?? '', line1: a?.line1 ?? '', line2: a?.line2 ?? '', city: a?.city ?? '', region: a?.region ?? '', postalCode: a?.postalCode ?? '', country: a?.country ?? '', phone: a?.phone ?? '' });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((c) => `${c.title} ${c.variantTitle} ${c.sku}`.toLowerCase().includes(q)).slice(0, 8);
  }, [catalog, query]);
  const subtotal = lines.reduce((s, l) => s + l.priceCents * l.quantity, 0);
  const total = Math.max(0, subtotal - (discount ?? 0)) + (shipping ?? 0);

  const addVariant = (c: CatalogEntry) => {
    setLines((cur) => {
      const had = cur.find((l) => l.variantId === c.variantId);
      if (had) return cur.map((l) => (l === had ? { ...l, quantity: Math.min(999, l.quantity + 1) } : l));
      return [...cur, { key: nextKey(), variantId: c.variantId, title: c.title, variantTitle: c.variantTitle, priceCents: c.priceCents, quantity: 1, stock: c.stock }];
    });
    setQuery('');
  };
  const body = () => ({
    email,
    name,
    phone,
    lines: lines.map((l) => (l.variantId ? { variantId: l.variantId, quantity: l.quantity } : { title: l.title, priceCents: l.priceCents, quantity: l.quantity, requiresShipping: true })),
    address: addr.line1.trim() && addr.city.trim() && /^[A-Za-z]{2}$/.test(addr.country.trim()) ? { ...addr, name: addr.name || name || email } : null,
    shippingName,
    shippingCents: shipping ?? 0,
    discountCents: discount ?? 0,
    note,
  });

  /** Guarda y, si hay modo, confirma. */
  const save = async (mode: 'pending' | 'invoice' | 'paid' | null) => {
    if (!lines.length) return push(t('drafts.noLines'), 'bad');
    setBusy(true);
    const res = draft
      ? await api<{ order?: OrderDto }>(`/api/shop/orders/${draft.id}/draft`, { method: 'PATCH', json: body() })
      : await api<{ order?: OrderDto }>('/api/shop/drafts', { method: 'POST', json: body() });
    if (!res.ok || !res.data.order) {
      setBusy(false);
      return push(errText(res.data.error), 'bad');
    }
    const id = res.data.order.id;
    if (!mode) {
      setBusy(false);
      push(t('editor.saved'));
      if (!draft) router.replace(`/app/shop/orders/${id}`);
      else router.refresh();
      return;
    }
    const done = await api<{ emailSent?: boolean | null }>(`/api/shop/orders/${id}/draft`, { method: 'POST', json: { mode } });
    setBusy(false);
    if (!done.ok) {
      push(errText(done.data.error), 'bad');
      // El borrador ya quedó guardado: se queda en esta pantalla con su id.
      if (!draft) router.replace(`/app/shop/orders/${id}`);
      return;
    }
    router.replace(`/app/shop/orders/${id}`);
    router.refresh();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(null);
  };
  const remove = async () => {
    const res = await api(`/api/shop/orders/${draft!.id}/draft`, { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.replace('/app/shop/orders?status=draft');
    router.refresh();
  };

  return (
    <div className="app-page ui-page shop-page">
      <PageHeader back={{ href: '/app/shop/orders', label: t('nav.orders') }} title={draft ? t('drafts.editTitle', { n: draft.number }) : t('drafts.new')} description={t('drafts.desc')} />
      <form className="shop-editor" onSubmit={submit} data-testid="draft-editor">
        <div className="shop-editor-main">
          <section className="panel shop-panel" aria-labelledby="dr-items">
            <h2 className="shop-panel-title" id="dr-items">{t('order.items')}</h2>
            <label className="ui-field">
              <span className="label">{t('drafts.searchProducts')}</span>
              <input
                className="input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={catalog.length ? t('drafts.searchPh') : t('drafts.noCatalog')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (matches[0]) addVariant(matches[0]);
                  }
                }}
              />
            </label>
            {query.trim() && (
              <ul className="shop-picklist">
                {matches.length === 0 && <li className="ui-help">{t('products.noMatch')}</li>}
                {matches.map((c) => (
                  <li key={c.variantId}>
                    <button type="button" className="shop-pick" onClick={() => addVariant(c)}>
                      <span className="shop-rowtext">
                        <span className="shop-rowtitle">{c.title}</span>
                        <span className="shop-rowmeta">{[c.variantTitle, c.sku, c.stock != null ? t('editor.inStock', { n: c.stock }) : ''].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="data">{money(c.priceCents)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {lines.length === 0 ? (
              <p className="ui-help">{t('drafts.noLines')}</p>
            ) : (
              <ul className="shop-items shop-draft-lines">
                {lines.map((l) => (
                  <li key={l.key}>
                    <span className="shop-rowtext">
                      <span className="shop-rowtitle">{l.title}</span>
                      <span className="shop-rowmeta">
                        {[l.variantTitle, money(l.priceCents)].filter(Boolean).join(' · ')}
                        {l.stock != null && l.quantity > l.stock ? ` · ${t('drafts.notEnough', { n: l.stock })}` : ''}
                      </span>
                    </span>
                    <input
                      className="input shop-num-input"
                      type="number"
                      min={1}
                      max={999}
                      aria-label={t('drafts.quantity')}
                      value={l.quantity}
                      onChange={(e) => setLines((cur) => cur.map((x) => (x.key === l.key ? { ...x, quantity: Math.max(1, Math.min(999, Number(e.target.value) || 1)) } : x)))}
                    />
                    <span className="data">{money(l.priceCents * l.quantity)}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}>
                      {t('editor.remove')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {custom ? (
              <div className="shop-inline-form">
                <input className="input" autoFocus aria-label={t('drafts.customTitle')} placeholder={t('drafts.customTitle')} maxLength={200} value={custom.title} onChange={(e) => setCustom({ ...custom, title: e.target.value })} />
                <span className="shop-inline-money">
                  <MoneyInput id="dr-custom" label={t('drafts.customPrice', { currency })} value={custom.price} onChange={(c) => setCustom({ ...custom, price: c })} />
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!custom.title.trim() || custom.price == null}
                  onClick={() => {
                    setLines((cur) => [...cur, { key: nextKey(), variantId: null, title: custom.title.trim(), variantTitle: '', priceCents: custom.price ?? 0, quantity: 1, stock: null }]);
                    setCustom(null);
                  }}
                >
                  {t('drafts.addCustom')}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setCustom(null)}>
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-secondary btn-sm shop-self-start" onClick={() => setCustom({ title: '', price: null })}>
                {t('drafts.addCustom')}
              </button>
            )}
          </section>
          <section className="panel shop-panel" aria-labelledby="dr-totals">
            <h2 className="shop-panel-title" id="dr-totals">{t('drafts.charges')}</h2>
            <div className="ui-fields-2">
              <label className="ui-field">
                <span className="label">{t('drafts.discount', { currency })}</span>
                <MoneyInput id="dr-discount" label={t('drafts.discount', { currency })} value={discount} onChange={setDiscount} />
              </label>
              <label className="ui-field">
                <span className="label">{t('drafts.shipping', { currency })}</span>
                <MoneyInput id="dr-shipping" label={t('drafts.shipping', { currency })} value={shipping} onChange={setShipping} />
              </label>
            </div>
            <label className="ui-field">
              <span className="label">{t('drafts.shippingName')}</span>
              <input className="input" maxLength={80} value={shippingName} onChange={(e) => setShippingName(e.target.value)} />
            </label>
            <dl className="shop-totals">
              <dt>{t('order.subtotal')}</dt>
              <dd>{money(subtotal)}</dd>
              <dt className="shop-total">{t('order.total')}</dt>
              <dd className="shop-total" data-testid="draft-total">{money(total)}</dd>
            </dl>
            <p className="ui-help">{t('drafts.taxHelp')}</p>
          </section>
        </div>
        <aside className="shop-editor-side">
          <section className="panel shop-panel">
            <h2 className="shop-panel-title">{t('order.customer')}</h2>
            <label className="ui-field">
              <span className="label">{t('settings.contactEmail')}</span>
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} name="email" />
            </label>
            <label className="ui-field">
              <span className="label">{t('drafts.name')}</span>
              <input className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="ui-field">
              <span className="label">{t('drafts.phone')}</span>
              <input className="input" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
          </section>
          <section className="panel shop-panel">
            <h2 className="shop-panel-title">{t('order.shippingAddress')}</h2>
            <label className="ui-field">
              <span className="label">{t('drafts.line1')}</span>
              <input className="input" value={addr.line1} maxLength={200} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} />
            </label>
            <div className="ui-fields-2">
              <label className="ui-field">
                <span className="label">{t('drafts.city')}</span>
                <input className="input" value={addr.city} maxLength={120} onChange={(e) => setAddr({ ...addr, city: e.target.value })} />
              </label>
              <label className="ui-field">
                <span className="label">{t('settings.country')}</span>
                <input className="input data" value={addr.country} maxLength={2} placeholder="AR" onChange={(e) => setAddr({ ...addr, country: e.target.value.toUpperCase() })} />
              </label>
            </div>
            <p className="ui-help">{t('drafts.addressHelp')}</p>
          </section>
          <section className="panel shop-panel">
            <label className="ui-field">
              <span className="label">{t('order.customerNote')}</span>
              <textarea className="textarea" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="shop-stack-actions">
              <button type="submit" className="btn btn-secondary" disabled={busy}>
                {t('drafts.saveDraft')}
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save('invoice')}>
                {t('drafts.sendInvoice')}
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void save('paid')}>
                {t('drafts.markPaid')}
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void save('pending')}>
                {t('drafts.markPending')}
              </button>
              {draft && (
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
                  {t('editor.delete')}
                </button>
              )}
            </div>
            <p className="ui-help">{t('drafts.actionsHelp')}</p>
          </section>
        </aside>
      </form>
      <ConfirmDialog
        open={confirmDelete}
        danger
        title={t('drafts.deleteTitle', { n: draft?.number ?? 0 })}
        body={t('drafts.deleteBody')}
        confirmLabel={t('editor.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
      {toast}
    </div>
  );
}
