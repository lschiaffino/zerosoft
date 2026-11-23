'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import HeaderCell, { ColumnMenuContext } from './ColumnHeader';
import TableScroll from './TableScroll';
import SelectAllMatching, { useListQuery, type MatchingSelection } from './SelectAllMatching';
import { customSortValue } from '@/lib/crm-list-sort';
import PrivateRecord from './PrivateRecord';
import InlineEditCell from './InlineEditCell';
import { EditColumnsInBar, useTableColumns } from './EditColumns';
import RecordPreview from './RecordPreview';
import TagDots, { type TagDot } from './TagDots';
import CrmIcon from './CrmIcon';
import PhoneTouch from './PhoneTouch';
import CompanyLogo from './CompanyLogo';
import type { BulkEditField } from './BulkEditControls';
import BulkActionsBar from './BulkActionsBar';
import RecordNameCell from './RecordNameCell';
import type { CustomCell, CustomColumn } from './customFieldViews';
import { OwnerCell } from './TableExtraColumns';
import { useCrmOptions } from './CrmViewer';
import { formatPhoneDisplay } from '@/lib/crm-calls';

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
  /** La madre es un registro que la persona no ve. */
  parentPrivate?: boolean;
}

interface CompaniesTableProps {
  /** Columnas en orden (`cols` de la URL o de la vista activa) y si la primera queda fija. */
  viewCols?: string;
  viewFreeze?: boolean;
  rows: CompanyRow[];
  /** Columnas de custom fields (ocultas por defecto). */
  customColumns?: CustomColumn[];
  sort: string;
  locale: string;
  allTags?: Array<{ id: string; name: string }>;
  /** Propiedades editables en masa (owner, lifecycle, custom fields…). */
  bulkFields?: BulkEditField[];
  /** Personas del workspace (columna owner). */
  owners?: Array<{ value: string; label: string }>;
  /** Borrar y exportar en masa: solo admins (el server lo vuelve a chequear). */
  canDelete?: boolean;
  canExport?: boolean;
  /** Cuántos registros muestra el listado (para "Seleccionar todos los que coinciden"). */
  total?: number;
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
export default function CompaniesTable({ viewCols, viewFreeze, rows, sort, locale, allTags = [], bulkFields = [], customColumns = [], owners = [], canDelete = false, canExport = false, total = 0 }: CompaniesTableProps) {
  const t = useTranslations('crm');
  const crmOpts = useCrmOptions();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const columnDefs = [
    ...COLS.map((c) => ({ id: c.id, label: t(c.labelKey), defaultVisible: c.defaultVisible })),
    ...customColumns.map((c) => ({ id: c.id, label: c.label, defaultVisible: false })),
  ];
  const cols = useTableColumns({ entity: 'companies', columns: columnDefs, storageKey: 'zs-companies-columns', first: 'name', viewCols, viewFreeze, defaultFreeze: true });
  const order = cols.order;
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Otra página, filtro u orden: la selección se queda solo con las filas que siguen a la vista
  // (la barra masiva nunca actúa sobre registros que ya no se ven).
  const rowIds = rows.map((r) => r.id).join(',');
  const [matching, setMatching] = useState<MatchingSelection | null>(null);
  useEffect(() => {
    // Otro filtro, orden o página: "todos los que coinciden" ya no describe lo que se ve.
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


  // Encabezados con el menú de columna (ordenar, mover, quitar), como en HubSpot.
  const H = (id: string, label: string, opts: { asc?: string; desc?: string; className?: string; card?: string } = {}) => (
    <HeaderCell id={id} label={label} sort={sort} {...opts} />
  );
  const headCells: Record<string, ReactNode> = {
    name: H('name', t('companies.table.name'), { asc: 'name', desc: 'name_desc', card: 'main' }),
    domain: H('domain', t('companies.table.domain')),
    industry: H('industry', t('companies.table.industry')),
    phone: H('phone', t('companies.table.phone')),
    location: H('location', t('companies.table.location')),
    contacts: H('contacts', t('companies.table.contacts'), { className: 'num' }),
    deals: H('deals', t('deals.title'), { className: 'num' }),
    lifecycle: H('lifecycle', t('companies.table.lifecycle')),
    tags: H('tags', t('tags.column')),
    owner: H('owner', t('filters.field.owner'), { asc: 'owner', desc: 'owner_desc' }),
    parent: H('parent', t('companies.detail.parent')),
    created: H('created', t('companies.table.created'), { asc: 'oldest', desc: 'newest' }),
    lastActivity: H('lastActivity', t('activityDates.lastActivity'), { asc: 'last_activity_asc', desc: 'last_activity', className: 'num cell-date' }),
    lastContacted: H('lastContacted', t('activityDates.lastContacted'), { asc: 'last_contacted_asc', desc: 'last_contacted', className: 'num cell-date' }),
    nextActivity: H('nextActivity', t('activityDates.nextActivity'), { asc: 'next_activity', desc: 'next_activity_desc', className: 'num cell-date' }),
  };
  for (const c of customColumns) {
    const name = c.id.startsWith('custom:') ? c.id.slice(7) : c.id;
    headCells[c.id] = H(c.id, c.label, { asc: customSortValue(name), desc: customSortValue(name, true), className: c.numeric ? 'num' : undefined });
  }
  const customById = new Map(customColumns.map((c) => [c.id, c]));

  function bodyCell(id: string, row: CompanyRow): ReactNode {
    switch (id) {
      case 'name':
        return (
          <RecordNameCell
            href={`/app/crm/companies/${row.id}`}
            name={row.name}
            avatar={<CompanyLogo domain={row.domain} name={row.name} size={24} />}
            onPreview={() => setPreviewId(row.id)}
          />
        );
      case 'domain':
        return (
          <td data-card="line">
            <InlineEditCell
              endpoint={`/api/crm/companies/${row.id}`}
              field="domain"
              value={row.domain}
              className="cell-email muted"
            />
          </td>
        );
      case 'industry':
        return (
          <td data-card="line">
            <InlineEditCell
              endpoint={`/api/crm/companies/${row.id}`}
              field="industry"
              value={row.industry}
              className="muted"
            />
          </td>
        );
      case 'phone':
        return (
          <td className="cell-sub" data-card="line">
            <InlineEditCell
              endpoint={`/api/crm/companies/${row.id}`}
              field="phone"
              value={row.phone}
              displayValue={formatPhoneDisplay(row.phone)}
              className="muted"
            />
            {row.phone ? <PhoneTouch phone={row.phone} companyId={row.id} compact /> : null}
          </td>
        );
      case 'location':
        return <td className="muted cell-sub">{row.location || '—'}</td>;
      case 'contacts':
        return <td className="num">{row.contacts}</td>;
      case 'deals':
        return <td className="num">{row.deals}</td>;
      case 'lifecycle':
        return (
          <td data-card="state">
            <InlineEditCell
              endpoint={`/api/crm/companies/${row.id}`}
              field="lifecycleStage"
              value={row.lifecycle}
              type="select"
              options={crmOpts.choices('lifecycle', row.lifecycle)}
              className={`dot-label stage-${row.lifecycle}`}
            />
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
          <OwnerCell endpoint={`/api/crm/companies/${row.id}`} ownerId={row.ownerId} owners={owners} />
        );
      case 'parent':
        return <td className="muted cell-sub">{row.parentName || (row.parentPrivate ? <PrivateRecord label={t('common.privateRecord')} /> : '—')}</td>;
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
          entity="companies"
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
              <tr key={row.id} className={selected.has(row.id) ? 'is-selected' : undefined}>
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
            ))}
          </tbody>
        </table>
      </TableScroll>
      </ColumnMenuContext.Provider>

      {selected.size > 0 && (
        <BulkActionsBar
          entity="company"
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
        <RecordPreview type="company" id={previewId} locale={locale} owners={owners} onClose={() => setPreviewId(null)} />
      )}
    </>
  );
}
