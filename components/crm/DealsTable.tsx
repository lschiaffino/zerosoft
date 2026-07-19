'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

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
}

export default function DealsTable({ rows }: DealsTableProps) {
  const t = useTranslations('crm');

  return (
    <div className="table-wrap">
      <table className="table crm-table">
        <thead>
          <tr>
            <th>{t('deals.table.name')}</th>
            <th className="th-num">{t('deals.table.amount')}</th>
            <th>{t('deals.table.stage')}</th>
            <th>{t('deals.table.priority')}</th>
            <th>{t('deals.table.closeDate')}</th>
            <th className="th-num">{t('deals.table.age')}</th>
            <th className="th-num">{t('deals.table.contacts')}</th>
            <th>{t('deals.table.created')}</th>
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
