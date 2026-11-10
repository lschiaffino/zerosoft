'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { DealCallsRow } from '@/lib/calls/crm';
import { useDate } from './ui';

/** Deals abiertos con llamadas: cuántas, la última, próximos pasos y señales de riesgo. */
export default function CallsDeals({ deals, crmEnabled }: { deals: DealCallsRow[]; crmEnabled: boolean }) {
  const t = useTranslations('calls.deals');
  const date = useDate();
  return (
    <div className="app-page ui-page cl-page">
      <PageHeader title={t('title')} description={t('desc')} />
      {!crmEnabled ? (
        <EmptyState compact body={t('noCrm')} />
      ) : deals.length === 0 ? (
        <EmptyState product="calls" title={t('emptyTitle')} body={t('emptyBody')} action={{ label: t('emptyAction'), href: '/app/calls' }} />
      ) : (
        <div className="table-wrap">
          <table className="table cl-table" data-testid="calls-deals">
            <thead>
              <tr>
                <th scope="col">{t('colDeal')}</th>
                <th scope="col" className="num">
                  {t('colCalls')}
                </th>
                <th scope="col" className="cl-hide-sm">
                  {t('colLast')}
                </th>
                <th scope="col">{t('colRisks')}</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id} data-testid="calls-deal-row">
                  <th scope="row">
                    <Link href={`/app/calls?deal=${d.id}`} className="cl-rowlink">
                      <span className="cl-rowtitle">{d.name}</span>
                      <span className="cl-rowmeta">
                        {[d.stage, d.closeDate ? t('closes', { date: date(d.closeDate, false) }) : ''].filter(Boolean).join(' · ')}
                      </span>
                      {d.nextSteps[0] && <span className="cl-rowsummary">{t('next', { step: d.nextSteps[0] })}</span>}
                    </Link>
                  </th>
                  <td className="num">{d.calls}</td>
                  <td className="cl-hide-sm">{date(d.lastCallAt, false)}</td>
                  <td>
                    {d.risks.length === 0 ? (
                      <span className="cl-muted">{t('noRisk')}</span>
                    ) : (
                      <ul className="cl-risks">
                        {d.risks.map((r) => (
                          <li key={r}>
                            <span className="badge badge-warn">{t(`risk.${r}`, { competitors: d.competitors.join(', ') })}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
