'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import SortTh from './SortTh';

export interface DealRow {
  id: string;
  name: string;
  amount: string;
  stage: string;
  priority: string;
  priorityLabel: string;
  closeDate: string;
  age: number;
  contacts: number;
  created: string;
}

interface DealsTableProps {
  rows: DealRow[];
  sort: string;
}

export default function DealsTable({ rows, sort }: DealsTableProps) {
  const t = useTranslations('crm');

  return (
    <div className="table-wrap">
      <table className="table crm-table">
        <thead>
          <tr>
            <th>{t('deals.table.name')}</th>
            <th className="th-num">
              <SortTh
                label={t('deals.table.amount')}
                asc="amount_asc"
                desc="amount"
                current={sort}
              />
            </th>
            <th>{t('deals.table.stage')}</th>
            <th>{t('deals.table.priority')}</th>
            <th>
              <SortTh
                label={t('deals.table.closeDate')}
                asc="close_date"
                desc="close_date_desc"
                current={sort}
              />
            </th>
            <th className="th-num">{t('deals.table.age')}</th>
            <th className="th-num">{t('deals.table.contacts')}</th>
            <th>
              <SortTh label={t('deals.table.created')} asc="oldest" desc="newest" current={sort} />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={`/app/crm/deals/${row.id}`} className="cell-name">
                  {row.name}
                </Link>
              </td>
              <td className="cell-amount td-num">{row.amount}</td>
              <td className="muted">{row.stage}</td>
              <td>
                <span className={`badge prio-${row.priority}`}>{row.priorityLabel}</span>
              </td>
              <td className="mono muted cell-date">{row.closeDate || '—'}</td>
              <td className="mono muted td-num">{row.age}d</td>
              <td className="mono td-num">{row.contacts}</td>
              <td className="mono muted cell-date">{row.created}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
