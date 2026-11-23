'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import HeaderCell, { ColumnMenuContext } from './ColumnHeader';
import TableScroll from './TableScroll';
import SelectAllMatching, { useListQuery, type MatchingSelection } from './SelectAllMatching';
import RecordNameCell from './RecordNameCell';
import BulkActionsBar from './BulkActionsBar';
import { customSortValue } from '@/lib/crm-list-sort';
import PrivateRecord from './PrivateRecord';
import InlineEditCell from './InlineEditCell';
import InlineStageCell from './InlineStageCell';
import { EditColumnsInBar, useTableColumns } from './EditColumns';
import RecordPreview from './RecordPreview';
import { ExpandToggle, RowExpansionRow, useRowExpansion } from './RowExpansion';
import TagDots, { type TagDot } from './TagDots';
import type { BulkEditField } from './BulkEditControls';
import type { CustomCell, CustomColumn } from './customFieldViews';
import { OwnerCell } from './TableExtraColumns';

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
  /** La empresa primaria es un registro que la persona no ve. */
  companyPrivate?: boolean;
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
  /** Columnas en orden (`cols` de la URL o de la vista activa) y si la primera queda fija. */
  viewCols?: string;
  viewFreeze?: boolean;
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
  /** Borrar y exportar en masa: solo admins (el server lo vuelve a chequear). */
  canDelete?: boolean;
  canExport?: boolean;
  /** Cuántos deals muestra el listado (para "Seleccionar todos los que coinciden"). */
  total?: number;
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

export default function DealsTable({ viewCols, viewFreeze,
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
  canDelete = false,
  canExport = false,
  total = 0,
}: DealsTableProps) {
  const t = useTranslations('crm');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [matching, setMatching] = useState<MatchingSelection | null>(null);

  // Otra página, filtro u orden: la selección se queda solo con las filas que siguen a la vista
  // y "todos los que coinciden" se cae (ya no describe lo que se ve).
  const rowIds = rows.map((r) => r.id).join(',');
  useEffect(() => {
    setMatching(null);
    const shown = new Set(rowIds.split(','));
    setSelected((prev) => (prev.size && [...prev].some((id) => !shown.has(id)) ? new Set([...prev].filter((id) => shown.has(id))) : prev));
  }, [rowIds]);

  // Otro filtro u orden con las mismas filas en la página: "todos los que coinciden" tampoco sigue.
  const listQuery = useListQuery();
  useEffect(() => setMatching(null), [listQuery]);
  const liveMatching = matching && matching.query === listQuery ? matching : null;

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
    setMatching(null);
    setBulkNotice(null);
  }
  function toggleOne(id: string) {
    setMatching(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBulkNotice(null);
  }
  const columnDefs = [
    ...COLS.map((c) => ({ id: c.id, label: t(c.labelKey), defaultVisible: c.defaultVisible })),
    ...customColumns.map((c) => ({ id: c.id, label: c.label, defaultVisible: false })),
  ];
  const cols = useTableColumns({ entity: 'deals', columns: columnDefs, storageKey: 'zs-deals-columns', first: 'name', viewCols, viewFreeze });
  const order = cols.order;
  const [previewId, setPreviewId] = useState<string | null>(null);
  // Filas desplegadas (asociados y última actividad, como la vista previa de fila de HubSpot).
  const rowIdList = rows.map((r) => r.id);
  const expansion = useRowExpansion('deal', rowIdList);

  // Encabezados con el menú de columna (ordenar, mover, quitar), como en HubSpot.
  const H = (id: string, label: string, opts: { asc?: string; desc?: string; className?: string; card?: string } = {}) => (
    <HeaderCell id={id} label={label} sort={sort} {...opts} />
  );
  const headCells: Record<string, ReactNode> = {
    name: H('name', t('deals.table.name'), { card: 'main' }),
    amount: H('amount', t('deals.table.amount'), { asc: 'amount_asc', desc: 'amount', className: 'num' }),
    stage: H('stage', t('deals.table.stage')),
    priority: H('priority', t('deals.table.priority')),
    source: H('source', t('deals.table.source')),
    closeDate: H('closeDate', t('deals.table.closeDate'), { asc: 'close_date', desc: 'close_date_desc', className: 'num cell-date' }),
    age: H('age', t('deals.table.age'), { className: 'num' }),
    contacts: H('contacts', t('deals.table.contacts'), { className: 'num' }),
    company: H('company', t('deals.detail.company')),
    tags: H('tags', t('tags.column')),
    owner: H('owner', t('filters.field.owner'), { asc: 'owner', desc: 'owner_desc' }),
    created: H('created', t('deals.table.created'), { asc: 'oldest', desc: 'newest', className: 'num cell-date' }),
    lastActivity: H('lastActivity', t('activityDates.lastActivity'), { asc: 'last_activity_asc', desc: 'last_activity', className: 'num cell-date' }),
    lastContacted: H('lastContacted', t('activityDates.lastContacted'), { asc: 'last_contacted_asc', desc: 'last_contacted', className: 'num cell-date' }),
    nextActivity: H('nextActivity', t('activityDates.nextActivity'), { asc: 'next_activity', desc: 'next_activity_desc', className: 'num cell-date' }),
  };
  for (const c of customColumns) {
    const name = c.id.startsWith('custom:') ? c.id.slice(7) : c.id;
    headCells[c.id] = H(c.id, c.label, { asc: customSortValue(name), desc: customSortValue(name, true), className: c.numeric ? 'num' : undefined });
  }
  const customById = new Map(customColumns.map((c) => [c.id, c]));

  function bodyCell(id: string, row: DealRow): ReactNode {
    switch (id) {
      case 'name':
        // Como contactos y empresas: el nombre abre la vista previa; "Abrir" (o Cmd/Ctrl+clic) va al deal.
        return <RecordNameCell href={`/app/crm/deals/${row.id}`} name={row.name} expand={<ExpandToggle id={row.id} name={row.name} expanded={expansion.open.has(row.id)} onToggle={() => expansion.toggle(row.id)} />} avatar={null} onPreview={() => setPreviewId(row.id)} />;
      case 'amount':
        return (
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
        );
      case 'stage':
        return (
          <td data-card="state">
            <InlineStageCell dealId={row.id} stageId={row.stageId} stages={stages} />
          </td>
        );
      case 'priority':
        return (
          <td>
            <InlineEditCell
              endpoint={`/api/crm/deals/${row.id}`}
              field="priority"
              value={row.priority}
              type="select"
              options={priorities}
              className={`dot-label prio-${row.priority}`}
            />
          </td>
        );
      case 'source':
        return (
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
        );
      case 'closeDate':
        return (
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
        );
      case 'age':
        return <td className="num muted">{row.age}d</td>;
      case 'contacts':
        return <td className="num">{row.contacts}</td>;
      case 'company':
        return (
          <td className="muted cell-sub" data-card="line">
            {row.companyName || (row.companyPrivate ? <PrivateRecord label={t('common.privateRecord')} /> : <span className="cell-empty">—</span>)}
          </td>
        );
      case 'tags':
        return (
          <td className="cell-crm-tags">
            <TagDots tags={row.tags ?? []} max={2} />
          </td>
        );
      case 'owner':
        return (
          <OwnerCell endpoint={`/api/crm/deals/${row.id}`} ownerId={row.ownerId} owners={owners} />
        );
      case 'created':
        return <td className="num muted cell-date">{row.created}</td>;
      case 'lastActivity':
        return <td className="num muted cell-date">{row.lastActivity || '—'}</td>;
      case 'lastContacted':
        return <td className="num muted cell-date">{row.lastContacted || '—'}</td>;
      case 'nextActivity':
        return <td className="num muted cell-date">{row.nextActivity || '—'}</td>;
      default: {
        const c = customById.get(id);
        if (!c) return null;
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
      }
    }
  }

  return (
    <>
      <EditColumnsInBar
        columns={columnDefs}
        first="name"
        order={cols.order}
        freeze={cols.freeze}
        onApply={cols.apply}
        onReset={cols.reset}
      />

      {allSelected && (
        <SelectAllMatching
          entity="deals"
          pageCount={rows.length}
          total={total}
          matching={liveMatching}
          onMatching={setMatching}
          onClear={() => {
            setMatching(null);
            setSelected(new Set());
          }}
        />
      )}

      <ColumnMenuContext.Provider value={{ order: cols.order, first: 'name', freeze: cols.freeze, apply: cols.apply }}>
      <TableScroll>
        <table className={`table crm-table crm-cards${cols.freeze ? ' is-frozen' : ''}`}>
          <thead>
            <tr>
              <th className="cell-check" data-card="check">
                <input
                  type="checkbox"
                  className="row-check"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label={t('common.all')}
                />
              </th>
              {order.map((id) => (
                <Fragment key={id}>{headCells[id]}</Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.id}>
              <tr className={`${selected.has(row.id) ? 'is-selected' : ''}${expansion.open.has(row.id) ? ' is-expanded' : ''}`.trim() || undefined}>
                <td className="cell-check" data-card="check">
                  <input
                    type="checkbox"
                    className="row-check"
                    checked={selected.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                    aria-label={row.name}
                  />
                </td>
                {order.map((id) => (
                  <Fragment key={id}>{bodyCell(id, row)}</Fragment>
                ))}
              </tr>
              {expansion.open.has(row.id) && (
                <RowExpansionRow
                  kind="deal"
                  id={row.id}
                  name={row.name}
                  colSpan={order.length + 1}
                  data={expansion.data[row.id]}
                  onRetry={() => void expansion.retry(row.id)}
                  onClose={() => expansion.toggle(row.id)}
                />
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </TableScroll>
      </ColumnMenuContext.Provider>

      {selected.size > 0 && (
        <BulkActionsBar
          entity="deal"
          ids={[...selected]}
          matching={liveMatching ? { query: liveMatching.query, count: liveMatching.count } : undefined}
          owners={owners}
          bulkFields={bulkFields}
          allTags={allTags}
          canDelete={canDelete}
          canExport={canExport}
          onClear={() => {
            setSelected(new Set());
            setMatching(null);
          }}
          onNotice={(notice) => {
            setSelected(new Set());
            setMatching(null);
            setBulkNotice(notice);
          }}
        />
      )}

      {bulkNotice && selected.size === 0 && (
        <p className="muted bulk-notice" role="status">
          {bulkNotice}
        </p>
      )}

      {previewId && (
        <RecordPreview type="deal" id={previewId} locale={locale} owners={owners} onClose={() => setPreviewId(null)} />
      )}
    </>
  );
}
