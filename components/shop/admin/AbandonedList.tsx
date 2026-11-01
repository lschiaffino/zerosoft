'use client';

import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { AbandonedDto } from '@/lib/shop-abandoned';
import { api, useDate, useErrorText, useMoney, useToast } from './shop-ui';
import { OrdersNav } from './OrdersList';

function Amount({ cents, currency }: { cents: number; currency: string }) {
  const money = useMoney(currency);
  return <>{money(cents)}</>;
}

/** Checkouts que quedaron a medias: copiar el link, mandar el recordatorio y ver cuáles se recuperaron. */
export default function AbandonedList({ initial, autoEmail }: { initial: AbandonedDto[]; autoEmail: boolean }) {
  const t = useTranslations('shop');
  const router = useRouter();
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const copy = (url: string) => void navigator.clipboard?.writeText(url).then(() => push(t('common.copied')));
  const remind = async (id: string) => {
    const res = await api(`/api/shop/abandoned/${id}`, { method: 'POST' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(t('abandoned.sent'));
    router.refresh();
  };
  return (
    <div className="app-page ui-page shop-page">
      <PageHeader title={t('abandoned.title')} description={t('abandoned.desc')} />
      <OrdersNav active="abandoned" />
      <p className="ui-help shop-note">
        {autoEmail ? t('abandoned.autoOn') : t('abandoned.autoOff')} <Link href="/app/shop/settings?tab=notifications">{t('abandoned.configure')}</Link>
      </p>
      {initial.length === 0 ? (
        <EmptyState product="shop" title={t('abandoned.emptyTitle')} body={t('abandoned.emptyBody')} />
      ) : (
        <div className="table-wrap table-stack">
          <table className="table shop-table" data-testid="abandoned-table">
            <thead>
              <tr>
                <th scope="col">{t('abandoned.colCustomer')}</th>
                <th scope="col">{t('abandoned.colDate')}</th>
                <th scope="col">{t('abandoned.colStatus')}</th>
                <th scope="col" className="num">{t('order.subtotal')}</th>
                <th scope="col"><span className="sr-only">{t('abandoned.colActions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {initial.map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    <span className="shop-rowtext">
                      <span className="shop-rowtitle">{c.name || c.email}</span>
                      <span className="shop-rowmeta">{c.name ? `${c.email} · ` : ''}{t('abandoned.items', { n: c.items })}</span>
                    </span>
                  </th>
                  <td data-label={t('abandoned.colDate')}>{date(c.updatedAt)}</td>
                  <td data-label={t('abandoned.colStatus')}>
                    {c.status === 'recovered' ? (
                      <span className="badge badge-ok">{t('abandoned.recovered')}</span>
                    ) : c.emailState === 'sent' ? (
                      <span className="badge badge-info">{t('abandoned.emailed')}</span>
                    ) : c.emailState === 'optout' ? (
                      <span className="badge badge-outline">{t('abandoned.optedOut')}</span>
                    ) : (
                      <span className="badge badge-warn">{t('abandoned.open')}</span>
                    )}
                  </td>
                  <td className="num" data-label={t('order.subtotal')}><Amount cents={c.subtotalCents} currency={c.currency} /></td>
                  <td className="table-stack-actions">
                    {c.status === 'recovered' && c.orderId ? (
                      <Link className="btn btn-secondary btn-sm" href={`/app/shop/orders/${c.orderId}`}>{t('abandoned.viewOrder')}</Link>
                    ) : (
                      <span className="shop-row-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(c.url)}>{t('abandoned.copyLink')}</button>
                        {c.emailState !== 'sent' && c.emailState !== 'optout' && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void remind(c.id)}>{t('abandoned.remind')}</button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {toast}
    </div>
  );
}
