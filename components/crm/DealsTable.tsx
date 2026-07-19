'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import SortTh from './SortTh';
import InlineEditCell from './InlineEditCell';
import InlineStageCell from './InlineStageCell';
import ColumnToggle, { useColumnVisibility } from './ColumnToggle';
import RecordPreview from './RecordPreview';

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
  { id: 'created', labelKey: 'deals.table.created', defaultVisible: true },
];

export default function DealsTable({ rows, sort, stages, priorities, sources, locale }: DealsTableProps) {
  const t = useTranslations('crm');
  const [visible, toggleVisible] = useColumnVisibility(
    COLS.map((c) => ({ id: c.id, label: t(c.labelKey), defaultVisible: c.defaultVisible })),
    'zs-deals-columns',
  );
  const [previewId, setPreviewId] = useState<string | null>(null);

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
              {visible.has('name') && <th>{t('deals.table.name')}</th>}
              {visible.has('amount') && (
                <th className="th-num">
                  <SortTh label={t('deals.table.amount')} asc="amount_asc" desc="amount" current={sort} />
                </th>
              )}
              {visible.has('stage') && <th>{t('deals.table.stage')}</th>}
              {visible.has('priority') && <th>{t('deals.table.priority')}</th>}
              {visible.has('source') && <th>{t('deals.table.source')}</th>}
              {visible.has('closeDate') && (
                <th>
                  <SortTh
                    label={t('deals.table.closeDate')}
                    asc="close_date"
                    desc="close_date_desc"
                    current={sort}
                  />
                </th>
              )}
              {visible.has('age') && <th className="th-num">{t('deals.table.age')}</th>}
              {visible.has('contacts') && <th className="th-num">{t('deals.table.contacts')}</th>}
              {visible.has('created') && (
                <th>
                  <SortTh label={t('deals.table.created')} asc="oldest" desc="newest" current={sort} />
                </th>
              )}
              <th className="cell-actions-head">{t('deals.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {visible.has('name') && (
                  <td>
                    <Link href={`/app/crm/deals/${row.id}`} className="cell-name">
                      {row.name}
                    </Link>
                  </td>
                )}
                {visible.has('amount') && (
                  <td className="cell-amount td-num">
                    <InlineEditCell
                      endpoint={`/api/crm/deals/${row.id}`}
                      field="amount"
                      value={String(row.amountValue)}
                      type="number"
                      className="mono"
                    />
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
                  <td className="mono muted cell-date">
                    <InlineEditCell
                      endpoint={`/api/crm/deals/${row.id}`}
                      field="closeDate"
                      value={row.closeDateIso}
                      type="date"
                      nullOption
                      className="muted"
                    />
                  </td>
                )}
                {visible.has('age') && <td className="mono muted td-num">{row.age}d</td>}
                {visible.has('contacts') && <td className="mono td-num">{row.contacts}</td>}
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

      {previewId && (
        <RecordPreview type="deal" id={previewId} locale={locale} onClose={() => setPreviewId(null)} />
      )}
    </>
  );
}
