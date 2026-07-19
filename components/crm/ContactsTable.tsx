'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import SortTh from './SortTh';
import InlineEditCell from './InlineEditCell';
import ColumnToggle, { useColumnVisibility } from './ColumnToggle';

export interface ContactRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  companyName: string | null;
  companyId: string | null;
  lifecycle: string;
  leadStatus: string;
  source: string;
  created: string;
}

interface Option {
  value: string;
  label: string;
}

interface ContactsTableProps {
  rows: ContactRow[];
  lifecycles: string[];
  leadStatuses: string[];
  sources: string[];
  sort: string;
  companies?: Option[];
}

const COLS = [
  { id: 'name', labelKey: 'contacts.table.name', defaultVisible: true },
  { id: 'email', labelKey: 'contacts.table.email', defaultVisible: true },
  { id: 'phone', labelKey: 'contacts.table.phone', defaultVisible: true },
  { id: 'company', labelKey: 'contacts.table.company', defaultVisible: true },
  { id: 'lifecycle', labelKey: 'contacts.table.lifecycle', defaultVisible: true },
  { id: 'leadStatus', labelKey: 'contacts.table.leadStatus', defaultVisible: true },
  { id: 'source', labelKey: 'contacts.table.source', defaultVisible: false },
  { id: 'created', labelKey: 'contacts.table.created', defaultVisible: true },
];

/** Tabla de contactos con selección múltiple, bulk bar, selector de columnas y edición inline. */
export default function ContactsTable({
  rows,
  lifecycles,
  leadStatuses,
  sources,
  sort,
  companies = [],
}: ContactsTableProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [bulkLifecycle, setBulkLifecycle] = useState(lifecycles[0] ?? 'lead');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [visible, toggleVisible] = useColumnVisibility(
    COLS.map((c) => ({ id: c.id, label: t(c.labelKey), defaultVisible: c.defaultVisible })),
    'zs-contacts-columns',
  );

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
    await fetch('/api/crm/contacts/bulk', {
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
  const leadStatusOpts = leadStatuses.map((v) => ({ value: v, label: t(`enums.leadStatus.${v}`) }));
  const sourceOpts = sources.map((v) => ({ value: v, label: t(`enums.source.${v}`) }));

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
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label={t('common.all')}
                />
              </th>
              {visible.has('name') && (
                <th>
                  <SortTh label={t('contacts.table.name')} asc="name" desc="name_desc" current={sort} />
                </th>
              )}
              {visible.has('email') && (
                <th>
                  <SortTh label={t('contacts.table.email')} asc="email" desc="email_desc" current={sort} />
                </th>
              )}
              {visible.has('phone') && <th>{t('contacts.table.phone')}</th>}
              {visible.has('company') && <th>{t('contacts.table.company')}</th>}
              {visible.has('lifecycle') && <th>{t('contacts.table.lifecycle')}</th>}
              {visible.has('leadStatus') && <th>{t('contacts.table.leadStatus')}</th>}
              {visible.has('source') && <th>{t('contacts.table.source')}</th>}
              {visible.has('created') && (
                <th>
                  <SortTh label={t('contacts.table.created')} asc="oldest" desc="newest" current={sort} />
                </th>
              )}
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
                {visible.has('name') && (
                  <td>
                    <Link href={`/app/crm/contacts/${row.id}`} className="cell-name">
                      {row.name}
                    </Link>
                  </td>
                )}
                {visible.has('email') && (
                  <td>
                    <InlineEditCell
                      endpoint={`/api/crm/contacts/${row.id}`}
                      field="email"
                      value={row.email}
                      type="email"
                      className="cell-email muted"
                    />
                    {row.email ? (
                      <a
                        href={`mailto:${row.email}`}
                        className="cell-quick"
                        title={t('enums.activityType.email')}
                      >
                        ✉
                      </a>
                    ) : null}
                  </td>
                )}
                {visible.has('phone') && (
                  <td className="cell-sub">
                    <InlineEditCell
                      endpoint={`/api/crm/contacts/${row.id}`}
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
                {visible.has('company') && (
                  <td>
                    {companies.length > 0 ? (
                      <InlineEditCell
                        endpoint={`/api/crm/contacts/${row.id}`}
                        field="companyId"
                        value={row.companyId ?? ''}
                        type="select"
                        nullOption
                        options={companies}
                        className="cell-sub"
                      />
                    ) : row.companyName && row.companyId ? (
                      <Link href={`/app/crm/companies/${row.companyId}`} className="cell-sub">
                        {row.companyName}
                      </Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                )}
                {visible.has('lifecycle') && (
                  <td>
                    <InlineEditCell
                      endpoint={`/api/crm/contacts/${row.id}`}
                      field="lifecycleStage"
                      value={row.lifecycle}
                      type="select"
                      options={lifecycleOpts}
                      className={`badge stage-${row.lifecycle}`}
                    />
                  </td>
                )}
                {visible.has('leadStatus') && (
                  <td>
                    <InlineEditCell
                      endpoint={`/api/crm/contacts/${row.id}`}
                      field="leadStatus"
                      value={row.leadStatus}
                      type="select"
                      options={leadStatusOpts}
                      className="badge"
                    />
                  </td>
                )}
                {visible.has('source') && (
                  <td className="muted cell-sub">
                    <InlineEditCell
                      endpoint={`/api/crm/contacts/${row.id}`}
                      field="source"
                      value={row.source}
                      type="select"
                      options={sourceOpts}
                      className="muted"
                    />
                  </td>
                )}
                {visible.has('created') && <td className="mono muted cell-date">{row.created}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar" role="toolbar">
          <span className="bulk-count">{t('contacts.bulk.selected', { count: selected.size })}</span>
          <select
            className="filter-select"
            value={bulkLifecycle}
            onChange={(e) => setBulkLifecycle(e.target.value)}
            aria-label={t('contacts.bulk.setLifecycle')}
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
            {t('contacts.bulk.apply')}
          </button>
          {confirmingDelete ? (
            <>
              <span className="bulk-count">
                {t('contacts.bulk.confirmDelete', { count: selected.size })}
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
              {t('contacts.bulk.delete')}
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
            {t('contacts.bulk.clear')}
          </button>
        </div>
      )}
    </>
  );
}
