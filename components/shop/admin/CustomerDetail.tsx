'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { CustomerDto } from '@/lib/shop';
import type { OrderListItem } from '@/lib/shop-orders';
import { StatusBadge, api, useDate, useErrorText, useMoney, useToast } from './shop-ui';

export default function CustomerDetail({ customer, orders, currency }: { customer: CustomerDto; orders: OrderListItem[]; currency: string }) {
  const t = useTranslations('shop');
  const money = useMoney(currency);
  const date = useDate();
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [tags, setTags] = useState(customer.tags.join(', '));
  const [note, setNote] = useState(customer.note);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await api(`/api/shop/customers/${customer.id}`, { method: 'PATCH', json: { tags: tags.split(',').map((x) => x.trim()).filter(Boolean), note } });
    setBusy(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(t('editor.saved'));
    router.refresh();
  };
  return (
    <div className="app-page ui-page shop-page">
      <PageHeader back={{ href: '/app/shop/customers', label: t('nav.customers') }} title={customer.name || customer.email} description={customer.email} />
      <div className="shop-kpis">
        <div className="shop-kpi">
          <span className="shop-kpi-label">{t('customers.colOrders')}</span>
          <span className="shop-kpi-value">{customer.ordersCount}</span>
        </div>
        <div className="shop-kpi">
          <span className="shop-kpi-label">{t('customers.colSpent')}</span>
          <span className="shop-kpi-value">{money(customer.totalSpentCents)}</span>
        </div>
        <div className="shop-kpi">
          <span className="shop-kpi-label">{t('customers.since')}</span>
          <span className="shop-kpi-value shop-kpi-small">{date(customer.createdAt, false)}</span>
        </div>
      </div>
      <section className="panel shop-panel">
        <h2 className="shop-panel-title">{t('customers.contact')}</h2>
        <p>{customer.email}</p>
        {customer.phone && <p>{customer.phone}</p>}
        {customer.crmContactId ? (
          <p>
            <Link href={`/app/crm/contacts/${customer.crmContactId}`}>{t('customers.openCrm')}</Link>
          </p>
        ) : (
          <p className="ui-help">{t('customers.crmPending')}</p>
        )}
      </section>
      <form className="panel shop-panel" onSubmit={save}>
        <h2 className="shop-panel-title">{t('customers.notes')}</h2>
        <label className="ui-field">
          <span className="label">{t('customers.tags')}</span>
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('customers.tagsPh')} name="tags" />
        </label>
        <label className="ui-field">
          <span className="label">{t('customers.note')}</span>
          <textarea className="textarea" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="shop-actions-row">
          <button type="submit" className="btn btn-primary" aria-busy={busy} disabled={busy}>{t('common.save')}</button>
        </div>
      </form>
      <section className="panel shop-panel">
        <h2 className="shop-panel-title">{t('nav.orders')}</h2>
        {orders.length === 0 ? (
          <p className="ui-help">{t('customers.noOrders')}</p>
        ) : (
          <ul className="shop-items">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/app/shop/orders/${o.id}`} className="data">
                  #{o.number}
                </Link>
                <span className="shop-rowmeta">{date(o.createdAt)}</span>
                <StatusBadge status={o.status} />
                <span className="data">{money(o.totalCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {toast}
    </div>
  );
}
