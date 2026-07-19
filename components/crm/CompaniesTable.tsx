'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import SortTh from './SortTh';
import InlineEditCell from './InlineEditCell';

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
  sort: string;
  lifecycles: string[];
}

/** Tabla de empresas con selección múltiple, bulk bar y edición inline. */
export default function CompaniesTable({ rows, sort, lifecycles }: CompaniesTableProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [bulkLifecycle, setBulkLifecycle] = useState(lifecycles[0] ?? 'lead');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
    setConfirmingDelete(false);
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirmingDelete(false);
  }

  async function bulk(body: Record<string, unknown>) {
    setBusy(true);
    await fetch('/api/crm/companies/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    setSelected(new Set());
    setConfirmingDelete(false);
    router.refresh();
  }

  return (
    <>
      <div className="table-wrap">
        <table className="table crm-table">
          <thead>
            <tr>
              <th className="cell-check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label={t('common.all')}
                />
              </th>
              <th>
                <SortTh label={t('companies.table.name')} asc="name" desc="name_desc" current={sort} />
              </th>
              <th>{t('companies.table.domain')}</th>
              <th>{t('companies.table.industry')}</th>
              <th>{t('companies.table.phone')}</th>
              <th>{t('companies.table.location')}</th>
              <th className="th-num">{t('companies.table.contacts')}</th>
              <th className="th-num">{t('deals.title')}</th>
              <th>{t('companies.table.lifecycle')}</th>
              <th>
                <SortTh
                  label={t('companies.table.created')}
                  asc="oldest"
                  desc="newest"
                  current={sort}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={busy && selected.has(row.id) ? 'row-busy' : undefined}>
                <td className="cell-check">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                    aria-label={row.name}
                  />
                </td>
                <td>
                  <Link href={`/app/crm/companies/${row.id}`} className="cell-name">
                    {row.name}
                  </Link>
                </td>
                <td>
                  <InlineEditCell
                    endpoint={`/api/crm/companies/${row.id}`}
                    field="domain"
                    value={row.domain}
                    className="cell-email muted"
                  />
                </td>
                <td>
                  <InlineEditCell
                    endpoint={`/api/crm/companies/${row.id}`}
                    field="industry"
                    value={row.industry}
                    className="muted"
                  />
                </td>
                <td className="cell-sub">
                  <InlineEditCell
                    endpoint={`/api/crm/companies/${row.id}`}
                    field="phone"
                    value={row.phone}
                    className="muted"
                  />
                  {row.phone ? (
                    <a
                      href={`tel:${row.phone}`}
                      className="cell-quick"
                      title={t('enums.activityType.call')}
                    >
                      ☎
                    </a>
                  ) : null}
                </td>
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

      {selected.size > 0 && (
        <div className="bulk-bar" role="toolbar">
          <span className="bulk-count">{t('companies.bulk.selected', { count: selected.size })}</span>
          <select
            className="filter-select"
            value={bulkLifecycle}
            onChange={(e) => setBulkLifecycle(e.target.value)}
            aria-label={t('companies.bulk.setLifecycle')}
            disabled={busy}
          >
            {lifecycles.map((v) => (
              <option key={v} value={v}>
                {t(`enums.lifecycle.${v}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="bulk-btn"
            disabled={busy}
            onClick={() =>
              bulk({ action: 'set_lifecycle', ids: [...selected], value: bulkLifecycle })
            }
          >
            {t('companies.bulk.apply')}
          </button>
          {confirmingDelete ? (
            <>
              <span className="bulk-count">
                {t('companies.bulk.confirmDelete', { count: selected.size })}
              </span>
              <button
                type="button"
                className="bulk-btn danger"
                disabled={busy}
                onClick={() => bulk({ action: 'delete', ids: [...selected] })}
              >
                {t('common.yes')}
              </button>
              <button
                type="button"
                className="bulk-btn"
                disabled={busy}
                onClick={() => setConfirmingDelete(false)}
              >
                {t('common.no')}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="bulk-btn danger"
              disabled={busy}
              onClick={() => setConfirmingDelete(true)}
            >
              {t('companies.bulk.delete')}
            </button>
          )}
          <button
            type="button"
            className="bulk-btn"
            disabled={busy}
            onClick={() => {
              setSelected(new Set());
              setConfirmingDelete(false);
            }}
          >
            {t('companies.bulk.clear')}
          </button>
        </div>
      )}
    </>
  );
}
