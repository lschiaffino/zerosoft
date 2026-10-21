'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import SortTh from './SortTh';
import InlineEditCell from './InlineEditCell';
import { ColumnToggleInBar, useColumnVisibility } from './ColumnToggle';
import RecordPreview from './RecordPreview';
import TagDots, { type TagDot } from './TagDots';
import TagBulkControls from './TagBulkControls';
import CrmIcon from './CrmIcon';
import PhoneTouch from './PhoneTouch';
import CompanyLogo from './CompanyLogo';
import BulkEditControls, { type BulkEditField } from './BulkEditControls';
import type { CustomCell, CustomColumn } from './customFieldViews';
import { CustomColumnHeader, OwnerCell, OwnerHeader } from './TableExtraColumns';

export interface CompanyRow {
  id: string;
  /** Owner (id de usuario) para la columna editable. */
  ownerId?: string | null;
  /** Custom fields ya formateados (`custom:<name>`). */
  custom?: Record<string, CustomCell>;
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
  /** Fechas de actividad ya formateadas ('' = sin fecha). */
  lastActivity?: string;
  lastContacted?: string;
  nextActivity?: string;
  tags?: TagDot[];
  /** Empresa madre (jerarquía). */
  parentName?: string | null;
}

interface CompaniesTableProps {
  rows: CompanyRow[];
  /** Columnas de custom fields (ocultas por defecto). */
  customColumns?: CustomColumn[];
  sort: string;
  lifecycles: string[];
  locale: string;
  allTags?: Array<{ id: string; name: string }>;
  /** Propiedades editables en masa (owner, lifecycle, custom fields…). */
  bulkFields?: BulkEditField[];
  /** Personas del workspace (columna owner). */
  owners?: Array<{ value: string; label: string }>;
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
  { id: 'tags', labelKey: 'tags.column', defaultVisible: true },
  { id: 'owner', labelKey: 'filters.field.owner', defaultVisible: true },
  { id: 'parent', labelKey: 'companies.detail.parent', defaultVisible: false },
  { id: 'created', labelKey: 'companies.table.created', defaultVisible: false },
  { id: 'lastActivity', labelKey: 'activityDates.lastActivity', defaultVisible: false },
  { id: 'lastContacted', labelKey: 'activityDates.lastContacted', defaultVisible: false },
  { id: 'nextActivity', labelKey: 'activityDates.nextActivity', defaultVisible: false },
];

/** Tabla de empresas con selección múltiple, bulk bar, selector de columnas, edición inline y preview. */
export default function CompaniesTable({ rows, sort, lifecycles, locale, allTags = [], bulkFields = [], customColumns = [], owners = [] }: CompaniesTableProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const columnDefs = [
    ...COLS.map((c) => ({ id: c.id, label: t(c.labelKey), defaultVisible: c.defaultVisible })),
    ...customColumns.map((c) => ({ id: c.id, label: c.label, defaultVisible: false })),
  ];
  const [visible, toggleVisible] = useColumnVisibility(
    columnDefs,
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
      <ColumnToggleInBar
        columns={columnDefs}
        visible={visible}
        onToggle={toggleVisible}
        label={t('common.columns')}
      />

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
                <th className="num">{t('companies.table.contacts')}</th>
              )}
              {visible.has('deals') && <th className="num">{t('deals.title')}</th>}
              {visible.has('lifecycle') && <th>{t('companies.table.lifecycle')}</th>}
              {visible.has('tags') && <th>{t('tags.column')}</th>}
              {visible.has('owner') && <OwnerHeader sort={sort} />}
              {visible.has('parent') && <th>{t('companies.detail.parent')}</th>}
              {visible.has('created') && (
                <th>
                  <SortTh label={t('companies.table.created')} asc="oldest" desc="newest" current={sort} />
                </th>
              )}
              {visible.has('lastActivity') && (
                <th className="num cell-date">
                  <SortTh label={t('activityDates.lastActivity')} asc="last_activity_asc" desc="last_activity" current={sort} />
                </th>
              )}
              {visible.has('lastContacted') && (
                <th className="num cell-date">
                  <SortTh label={t('activityDates.lastContacted')} asc="last_contacted_asc" desc="last_contacted" current={sort} />
                </th>
              )}
              {visible.has('nextActivity') && (
                <th className="num cell-date">
                  <SortTh label={t('activityDates.nextActivity')} asc="next_activity" desc="next_activity_desc" current={sort} />
                </th>
              )}
              {customColumns.map((c) => visible.has(c.id) && <CustomColumnHeader key={c.id} col={c} sort={sort} />)}
              <th className="cell-actions-head"><span className="sr-only">{t('companies.table.actions')}</span></th>
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
                    <Link href={`/app/crm/companies/${row.id}`} className="cell-name cell-name-logo">
                      <CompanyLogo domain={row.domain} name={row.name} size={18} />
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
                    {row.phone ? <PhoneTouch phone={row.phone} companyId={row.id} compact /> : null}
                  </td>
                )}
                {visible.has('location') && <td className="muted cell-sub">{row.location || '—'}</td>}
                {visible.has('contacts') && <td className="num">{row.contacts}</td>}
                {visible.has('deals') && <td className="num">{row.deals}</td>}
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
                {visible.has('tags') && (
                  <td className="cell-crm-tags">
                    <TagDots tags={row.tags ?? []} max={2} />
                  </td>
                )}
                {visible.has('owner') && (
                  <OwnerCell endpoint={`/api/crm/companies/${row.id}`} ownerId={row.ownerId} owners={owners} />
                )}
                {visible.has('parent') && <td className="muted cell-sub">{row.parentName || '—'}</td>}
                {visible.has('created') && <td className="num muted cell-date">{row.created}</td>}
                {visible.has('lastActivity') && <td className="num muted cell-date">{row.lastActivity || '—'}</td>}
                {visible.has('lastContacted') && <td className="num muted cell-date">{row.lastContacted || '—'}</td>}
                {visible.has('nextActivity') && <td className="num muted cell-date">{row.nextActivity || '—'}</td>}
                {customColumns.map((c) => {
                  if (!visible.has(c.id)) return null;
                  const cell = row.custom?.[c.id];
                  return (
                    <td key={c.id} className={c.numeric ? 'num cell-sub' : 'cell-sub'}>
                      {!cell ? (
                        <span className="muted">—</span>
                      ) : cell.href ? (
                        <a href={cell.href} target={cell.href.startsWith('tel:') ? undefined : '_blank'} rel="noreferrer">
                          {cell.text}
                        </a>
                      ) : (
                        cell.text
                      )}
                    </td>
                  );
                })}
                <td className="cell-actions">
                  <button
                    type="button"
                    className="icon-btn preview-btn"
                    onClick={() => setPreviewId(row.id)}
                    title={t('common.preview')}
                    aria-label={t('common.preview')}
                  >
                    <CrmIcon name="panel" />
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
          <BulkEditControls
            endpoint="/api/crm/companies/bulk"
            ids={[...selected]}
            fields={bulkFields}
            disabled={busy}
            onDone={(notice) => {
              setSelected(new Set());
              setBulkNotice(notice);
            }}
          />
          <TagBulkControls
            entity="company"
            ids={[...selected]}
            tags={allTags}
            disabled={busy}
            onDone={() => setSelected(new Set())}
          />
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

      {bulkNotice && selected.size === 0 && (
        <p className="muted bulk-notice" role="status">
          {bulkNotice}
        </p>
      )}

      {previewId && (
        <RecordPreview type="company" id={previewId} locale={locale} onClose={() => setPreviewId(null)} />
      )}
    </>
  );
}
