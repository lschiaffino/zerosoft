'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import SortTh from './SortTh';
import InlineEditCell from './InlineEditCell';
import ColumnToggle, { useColumnVisibility } from './ColumnToggle';
import RecordPreview from './RecordPreview';

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
  locale: string;
}

const COLS = [
  { id: 'name', labelKey: 'companies.table.name', defaultVisible: true },
  { id: 'domain', labelKey: 'companies.table.domain', defaultVisible: true },
  { id: 'industry', labelKey: 'companies.table.industry', defaultVisible: true },
  { id: 'phone', labelKey: 'companies.table.phone', defaultVisible: false },
  { id: 'location', labelKey: 'companies.table.location', defaultVisible: true },
  { id: 'contacts', labelKey: 'companies.table.contacts', defaultVisible: true },
  { id: 'deals', labelKey: 'deals.title', defaultVisible: true },
  { id: 'lifecycle', labelKey: 'companies.table.lifecycle', defaultVisible: true },
  { id: 'created', labelKey: 'companies.table.created', defaultVisible: false },
];

/** Tabla de empresas con selección múltiple, bulk bar, selector de columnas, edición inline y preview. */
export default function CompaniesTable({ rows, sort, lifecycles, locale }: CompaniesTableProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [bulkLifecycle, setBulkLifecycle] = useState(lifecycles[0] ?? 'lead');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [visible, toggleVisible] = useColumnVisibility(
    COLS.map((c) => ({ id: c.id, label: t(c.labelKey), defaultVisible: c.defaultVisible })),
    'zs-companies-columns',
  );
  const [previewId, setPreviewId] = useState<string | null>(null);

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

  const lifecycleOpts = lifecycles.map((v) => ({ value: v, label: t(`enums.lifecycle.${v}`) }));

  return (
    <>
      <div className="table-toolbar">
        <ColumnToggle
          columns={COLS.map((c) => ({ id: c.id, label: t(c.labelKey), defaultVisible: c.defaultVisible }))}
          visible={visible}
          onToggle={toggleVisible}
          label={t('common.columns')}
        />
      </div>

      <div className="table-wrap">
        <table className="table crm-table">
          <thead>
            <tr>
              <th className="cell-check">
                <input
                  type="checkbox"
                  className="row-check"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label={t('common.all')}
                />
              </th>
              {visible.has('name') && (
                <th>
                  <SortTh label={t('companies.table.name')} asc="name" desc="name_desc" current={sort} />
                </th>
              )}
              {visible.has('domain') && <th>{t('companies.table.domain')}</th>}
              {visible.has('industry') && <th>{t('companies.table.industry')}</th>}
              {visible.has('phone') && <th>{t('companies.table.phone')}</th>}
              {visible.has('location') && <th>{t('companies.table.location')}</th>}
              {visible.has('contacts') && (
                <th className="th-num">{t('companies.table.contacts')}</th>
              )}
              {visible.has('deals') && <th className="th-num">{t('deals.title')}</th>}
              {visible.has('lifecycle') && <th>{t('companies.table.lifecycle')}</th>}
              {visible.has('created') && (
                <th>
                  <SortTh label={t('companies.table.created')} asc="oldest" desc="newest" current={sort} />
                </th>
              )}
              <th className="cell-actions-head">{t('companies.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={busy && selected.has(row.id) ? 'row-busy' : undefined}>
                <td className="cell-check">
                  <input
                    type="checkbox"
                    className="row-check"
                    checked={selected.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                    aria-label={row.name}
                  />
                </td>
                {visible.has('name') && (
                  <td>
                    <Link href={`/app/crm/companies/${row.id}`} className="cell-name">
                      {row.name}
                    </Link>
                  </td>
                )}
                {visible.has('domain') && (
                  <td>
                    <InlineEditCell
                      endpoint={`/api/crm/companies/${row.id}`}
                      field="domain"
                      value={row.domain}
                      className="cell-email muted"
                    />
                  </td>
                )}
                {visible.has('industry') && (
                  <td>
                    <InlineEditCell
                      endpoint={`/api/crm/companies/${row.id}`}
                      field="industry"
                      value={row.industry}
                      className="muted"
                    />
                  </td>
                )}
                {visible.has('phone') && (
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
                )}
                {visible.has('location') && <td className="muted cell-sub">{row.location || '—'}</td>}
                {visible.has('contacts') && <td className="mono td-num">{row.contacts}</td>}
                {visible.has('deals') && <td className="mono td-num">{row.deals}</td>}
                {visible.has('lifecycle') && (
                  <td>
                    <InlineEditCell
                      endpoint={`/api/crm/companies/${row.id}`}
                      field="lifecycleStage"
                      value={row.lifecycle}
                      type="select"
                      options={lifecycleOpts}
                      className={`badge stage-${row.lifecycle}`}
                    />
                  </td>
                )}
                {visible.has('created') && <td className="mono muted cell-date">{row.created}</td>}
                <td className="cell-actions">
                  <button
                    type="button"
                    className="icon-btn preview-btn"
                    onClick={() => setPreviewId(row.id)}
                    title={t('common.viewAll')}
                    aria-label={t('common.viewAll')}
                  >
                    👁
                  </button>
                </td>
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

      {previewId && (
        <RecordPreview type="company" id={previewId} locale={locale} onClose={() => setPreviewId(null)} />
      )}
    </>
  );
}
