'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export interface CompanyRow {
  id: string;
  name: string;
  domain: string;
  industry: string;
  phone: string;
  location: string;
  contacts: number;
  deals: number;
  lifecycle: string;
  lifecycleLabel: string;
  created: string;
}

interface CompaniesTableProps {
  rows: CompanyRow[];
}

export default function CompaniesTable({ rows }: CompaniesTableProps) {
  const t = useTranslations('crm');

  return (
    <div className="table-wrap">
      <table className="table crm-table">
        <thead>
          <tr>
            <th>{t('companies.table.name')}</th>
            <th>{t('companies.table.domain')}</th>
            <th>{t('companies.table.industry')}</th>
            <th>{t('companies.table.phone')}</th>
            <th>{t('companies.table.location')}</th>
            <th className="th-num">{t('companies.table.contacts')}</th>
            <th className="th-num">{t('deals.title')}</th>
            <th>{t('companies.table.lifecycle')}</th>
            <th>{t('companies.table.created')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={`/app/crm/companies/${row.id}`} className="cell-name">
                  {row.name}
                </Link>
              </td>
              <td className="muted cell-email">{row.domain || '—'}</td>
              <td className="muted">{row.industry || '—'}</td>
              <td className="muted cell-sub">{row.phone || '—'}</td>
              <td className="muted cell-sub">{row.location || '—'}</td>
              <td className="mono td-num">{row.contacts}</td>
              <td className="mono td-num">{row.deals}</td>
              <td>
                <span className={`badge stage-${row.lifecycle}`}>{row.lifecycleLabel}</span>
              </td>
              <td className="mono muted cell-date">{row.created}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
