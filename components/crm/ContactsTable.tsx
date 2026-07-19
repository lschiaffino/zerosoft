'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import SortTh from './SortTh';
import InlineEditCell from './InlineEditCell';

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

interface ContactsTableProps {
  rows: ContactRow[];
  lifecycles: string[];
  sort: string;
}

/** Tabla de contactos con selección múltiple y bulk bar (set_lifecycle / delete). */
export default function ContactsTable({ rows, lifecycles, sort }: ContactsTableProps) {
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
                <SortTh label={t('contacts.table.name')} asc="name" desc="name_desc" current={sort} />
              </th>
              <th>
                <SortTh
                  label={t('contacts.table.email')}
                  asc="email"
                  desc="email_desc"
                  current={sort}
                />
              </th>
              <th>{t('contacts.table.phone')}</th>
              <th>{t('contacts.table.company')}</th>
              <th>{t('contacts.table.lifecycle')}</th>
              <th>{t('contacts.table.leadStatus')}</th>
              <th>{t('contacts.table.source')}</th>
              <th>
                <SortTh label={t('contacts.table.created')} asc="oldest" desc="newest" current={sort} />
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
                  <Link href={`/app/crm/contacts/${row.id}`} className="cell-name">
                    {row.name}
                  </Link>
                </td>
                <td>
                  <InlineEditCell
                    endpoint={`/api/crm/contacts/${row.id}`}
                    field="email"
                    value={row.email}
                    inputType="email"
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
                <td>
                  {row.companyName && row.companyId ? (
                    <Link href={`/app/crm/companies/${row.companyId}`} className="cell-sub">
                      {row.companyName}
                    </Link>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {row.lifecycle ? (
                    <span className={`badge stage-${row.lifecycle}`}>
                      {t(`enums.lifecycle.${row.lifecycle}`)}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {row.leadStatus ? (
                    <span className="badge">{t(`enums.leadStatus.${row.leadStatus}`)}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="muted cell-sub">
                  {row.source ? t(`enums.source.${row.source}`) : '—'}
                </td>
                <td className="mono muted cell-date">{row.created}</td>
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
