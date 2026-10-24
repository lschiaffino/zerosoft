'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import SortTh from './SortTh';
import InlineEditCell from './InlineEditCell';
import InlineStageCell from './InlineStageCell';
import { ColumnToggleInBar, useColumnVisibility } from './ColumnToggle';
import RecordPreview from './RecordPreview';
import CrmIcon from './CrmIcon';
import TagDots, { type TagDot } from './TagDots';
import TagBulkControls from './TagBulkControls';
import BulkEditControls, { type BulkEditField } from './BulkEditControls';
import type { CustomCell, CustomColumn } from './customFieldViews';
import { CustomColumnHeader, OwnerCell, OwnerHeader } from './TableExtraColumns';

export interface DealRow {
  id: string;
  /** Owner (id de usuario) para la columna editable. */
  ownerId?: string | null;
  /** Custom fields ya formateados (`custom:<name>`). */
  custom?: Record<string, CustomCell>;
  name: string;
  amount: string;
  amountValue: number;
  currency: string;
  stageId: string;
  stage: string;
  priority: string;
  priorityLabel: string;
  source: string;
  closeDate: string;
  closeDateIso: string;
  age: number;
  contacts: number;
  created: string;
  /** Fechas de actividad ya formateadas ('' = sin fecha). */
  lastActivity?: string;
  lastContacted?: string;
  nextActivity?: string;
  tags?: TagDot[];
  /** Empresa primaria. */
  companyName?: string | null;
  /** Monto convertido a la moneda base (texto), si la moneda es otra. */
  amountBase?: string | null;
}

interface StageOption {
  id: string;
  name: string;
  is_won: 0 | 1;
  is_lost: 0 | 1;
}

interface Option {
  value: string;
  label: string;
}

interface DealsTableProps {
  rows: DealRow[];
  /** Columnas de custom fields (ocultas por defecto). */
  customColumns?: CustomColumn[];
  sort: string;
  stages: StageOption[];
  priorities: Option[];
  sources: Option[];
  locale: string;
  allTags?: Array<{ id: string; name: string }>;
  /** Propiedades editables en masa (owner, etapa, custom fields…). */
  bulkFields?: BulkEditField[];
  /** Personas del workspace (columna owner). */
  owners?: Array<{ value: string; label: string }>;
}

const COLS = [
  { id: 'name', labelKey: 'deals.table.name', defaultVisible: true },
  { id: 'amount', labelKey: 'deals.table.amount', defaultVisible: true },
  { id: 'stage', labelKey: 'deals.table.stage', defaultVisible: true },
  { id: 'priority', labelKey: 'deals.table.priority', defaultVisible: true },
  { id: 'source', labelKey: 'deals.table.source', defaultVisible: false },
  { id: 'closeDate', labelKey: 'deals.table.closeDate', defaultVisible: true },
  { id: 'age', labelKey: 'deals.table.age', defaultVisible: false },
  { id: 'contacts', labelKey: 'deals.table.contacts', defaultVisible: false },
  { id: 'company', labelKey: 'deals.detail.company', defaultVisible: true },
  { id: 'tags', labelKey: 'tags.column', defaultVisible: true },
  { id: 'owner', labelKey: 'filters.field.owner', defaultVisible: true },
  { id: 'created', labelKey: 'deals.table.created', defaultVisible: true },
  { id: 'lastActivity', labelKey: 'activityDates.lastActivity', defaultVisible: false },
  { id: 'lastContacted', labelKey: 'activityDates.lastContacted', defaultVisible: false },
  { id: 'nextActivity', labelKey: 'activityDates.nextActivity', defaultVisible: false },
];

export default function DealsTable({
  rows,
  sort,
  stages,
  priorities,
  sources,
  locale,
  allTags = [],
  bulkFields = [],
  customColumns = [],
  owners = [],
}: DealsTableProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  /** Borrado en masa: los deals van a la papelera (solo admins; lo valida la ruta). */
  async function bulkDelete() {
    setBusy(true);
    const res = await fetch('/api/crm/deals/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete', ids: [...selected] }),
    }).catch(() => null);
    setBusy(false);
    setConfirmingDelete(false);
    if (!res?.ok) {
      setBulkNotice(res?.status === 403 ? t('errors.forbidden') : t('errors.generic'));
      return;
    }
    setSelected(new Set());
    setBulkNotice(t('trash.movedNotice'));
    router.refresh();
  }
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const columnDefs = [
    ...COLS.map((c) => ({ id: c.id, label: t(c.labelKey), defaultVisible: c.defaultVisible })),
    ...customColumns.map((c) => ({ id: c.id, label: c.label, defaultVisible: false })),
  ];
  const [visible, toggleVisible] = useColumnVisibility(
    columnDefs,
    'zs-deals-columns',
  );
  const [previewId, setPreviewId] = useState<string | null>(null);

  return (
    <>
      <ColumnToggleInBar
        columns={columnDefs}
        visible={visible}
        onToggle={toggleVisible}
        label={t('common.columns')}
      />

      <div className="table-wrap">
        <table className="table crm-table crm-cards">
          <thead>
            <tr>
              <th className="cell-check" data-card="check">
                <input
                  type="checkbox"
                  className="row-check"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                  aria-label={t('common.all')}
                />
              </th>
              {visible.has('name') && <th data-card="main">{t('deals.table.name')}</th>}
              {visible.has('amount') && (
                <th className="num">
                  <SortTh label={t('deals.table.amount')} asc="amount_asc" desc="amount" current={sort} />
                </th>
              )}
              {visible.has('stage') && <th>{t('deals.table.stage')}</th>}
              {visible.has('priority') && <th>{t('deals.table.priority')}</th>}
              {visible.has('source') && <th>{t('deals.table.source')}</th>}
              {visible.has('closeDate') && (
                <th className="num cell-date">
                  <SortTh
                    label={t('deals.table.closeDate')}
                    asc="close_date"
                    desc="close_date_desc"
                    current={sort}
                  />
                </th>
              )}
              {visible.has('age') && <th className="num">{t('deals.table.age')}</th>}
              {visible.has('contacts') && <th className="num">{t('deals.table.contacts')}</th>}
              {visible.has('company') && <th>{t('deals.detail.company')}</th>}
              {visible.has('tags') && <th>{t('tags.column')}</th>}
              {visible.has('owner') && <OwnerHeader sort={sort} />}
              {visible.has('created') && (
                <th className="num cell-date">
                  <SortTh label={t('deals.table.created')} asc="oldest" desc="newest" current={sort} />
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
              <th className="cell-actions-head"><span className="sr-only">{t('deals.table.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={busy && selected.has(row.id) ? 'row-busy' : undefined}>
                <td className="cell-check" data-card="check">
                  <input
                    type="checkbox"
                    className="row-check"
                    checked={selected.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                    aria-label={row.name}
                  />
                </td>
                {visible.has('name') && (
                  <td data-card="main">
                    <Link href={`/app/crm/deals/${row.id}`} className="cell-name">
                      {row.name}
                    </Link>
                  </td>
                )}
                {visible.has('amount') && (
                  <td className="cell-amount num" data-card="line">
                    <InlineEditCell
                      endpoint={`/api/crm/deals/${row.id}`}
                      field="amount"
                      value={String(row.amountValue)}
                      displayValue={row.amount}
                      type="number"
                      className="num"
                    />
                    {row.amountBase && <span className="muted num cell-converted">≈ {row.amountBase}</span>}
                  </td>
                )}
                {visible.has('stage') && (
                  <td data-card="state">
                    <InlineStageCell dealId={row.id} stageId={row.stageId} stages={stages} />
                  </td>
                )}
                {visible.has('priority') && (
                  <td>
                    <InlineEditCell
                      endpoint={`/api/crm/deals/${row.id}`}
                      field="priority"
                      value={row.priority}
                      type="select"
                      options={priorities}
                      className={`badge prio-${row.priority}`}
                    />
                  </td>
                )}
                {visible.has('source') && (
                  <td className="muted cell-sub">
                    <InlineEditCell
                      endpoint={`/api/crm/deals/${row.id}`}
                      field="source"
                      value={row.source}
                      type="select"
                      options={sources}
                      className="muted"
                    />
                  </td>
                )}
                {visible.has('closeDate') && (
                  <td className="num muted cell-date" data-card="line" data-card-label={t('deals.table.closeDate')}>
                    <InlineEditCell
                      endpoint={`/api/crm/deals/${row.id}`}
                      field="closeDate"
                      value={row.closeDateIso}
                      displayValue={row.closeDate}
                      type="date"
                      nullOption
                      className="muted"
                    />
                  </td>
                )}
                {visible.has('age') && <td className="num muted">{row.age}d</td>}
                {visible.has('contacts') && <td className="num">{row.contacts}</td>}
                {visible.has('company') && (
                  <td className="muted cell-sub" data-card="line">
                    {row.companyName || '—'}
                  </td>
                )}
                {visible.has('tags') && (
                  <td className="cell-crm-tags">
                    <TagDots tags={row.tags ?? []} max={2} />
                  </td>
                )}
                {visible.has('owner') && (
                  <OwnerCell endpoint={`/api/crm/deals/${row.id}`} ownerId={row.ownerId} owners={owners} />
                )}
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
          <span className="bulk-count">{t('deals.bulkSelected', { count: selected.size })}</span>
          <BulkEditControls
            endpoint="/api/crm/deals/bulk"
            ids={[...selected]}
            fields={bulkFields}
            disabled={busy}
            onDone={(notice) => {
              setSelected(new Set());
              setBulkNotice(notice);
            }}
          />
          <TagBulkControls entity="deal" ids={[...selected]} tags={allTags} disabled={busy} onDone={() => setSelected(new Set())} />
          {confirmingDelete ? (
            <>
              <span className="bulk-count">{t('deals.bulkConfirmDelete', { count: selected.size })}</span>
              <button type="button" className="bulk-btn danger" disabled={busy} onClick={bulkDelete}>
                {t('common.yes')}
              </button>
              <button type="button" className="bulk-btn" disabled={busy} onClick={() => setConfirmingDelete(false)}>
                {t('common.no')}
              </button>
            </>
          ) : (
            <button type="button" className="bulk-btn danger" disabled={busy} onClick={() => setConfirmingDelete(true)}>
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

      {bulkNotice && selected.size === 0 && (
        <p className="muted bulk-notice" role="status">
          {bulkNotice}
        </p>
      )}

      {previewId && (
        <RecordPreview type="deal" id={previewId} locale={locale} onClose={() => setPreviewId(null)} />
      )}
    </>
  );
}
