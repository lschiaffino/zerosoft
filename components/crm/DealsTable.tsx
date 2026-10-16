'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import SortTh from './SortTh';
import InlineEditCell from './InlineEditCell';
import InlineStageCell from './InlineStageCell';
import { ColumnToggleInBar, useColumnVisibility } from './ColumnToggle';
import RecordPreview from './RecordPreview';
import CrmIcon from './CrmIcon';
import TagDots, { type TagDot } from './TagDots';
import TagBulkControls from './TagBulkControls';

export interface DealRow {
  id: string;
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
  sort: string;
  stages: StageOption[];
  priorities: Option[];
  sources: Option[];
  locale: string;
  allTags?: Array<{ id: string; name: string }>;
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
  { id: 'created', labelKey: 'deals.table.created', defaultVisible: true },
];

export default function DealsTable({ rows, sort, stages, priorities, sources, locale, allTags = [] }: DealsTableProps) {
  const t = useTranslations('crm');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const [visible, toggleVisible] = useColumnVisibility(
    COLS.map((c) => ({ id: c.id, label: t(c.labelKey), defaultVisible: c.defaultVisible })),
    'zs-deals-columns',
  );
  const [previewId, setPreviewId] = useState<string | null>(null);

  return (
    <>
      <ColumnToggleInBar
        columns={COLS.map((c) => ({ id: c.id, label: t(c.labelKey), defaultVisible: c.defaultVisible }))}
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
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                  aria-label={t('common.all')}
                />
              </th>
              {visible.has('name') && <th>{t('deals.table.name')}</th>}
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
              {visible.has('created') && (
                <th className="num cell-date">
                  <SortTh label={t('deals.table.created')} asc="oldest" desc="newest" current={sort} />
                </th>
              )}
              <th className="cell-actions-head"><span className="sr-only">{t('deals.table.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
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
                    <Link href={`/app/crm/deals/${row.id}`} className="cell-name">
                      {row.name}
                    </Link>
                  </td>
                )}
                {visible.has('amount') && (
                  <td className="cell-amount num">
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
                  <td>
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
                  <td className="num muted cell-date">
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
                {visible.has('company') && <td className="muted cell-sub">{row.companyName || '—'}</td>}
                {visible.has('tags') && (
                  <td className="cell-crm-tags">
                    <TagDots tags={row.tags ?? []} max={2} />
                  </td>
                )}
                {visible.has('created') && <td className="num muted cell-date">{row.created}</td>}
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
          <TagBulkControls entity="deal" ids={[...selected]} tags={allTags} onDone={() => setSelected(new Set())} />
          <button type="button" className="bulk-btn" onClick={() => setSelected(new Set())}>
            {t('contacts.bulk.clear')}
          </button>
        </div>
      )}

      {previewId && (
        <RecordPreview type="deal" id={previewId} locale={locale} onClose={() => setPreviewId(null)} />
      )}
    </>
  );
}
