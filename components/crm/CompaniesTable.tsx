'use client';

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import HeaderCell from './ColumnHeader';
import TableScroll from './TableScroll';
import SelectAllMatching, { useListQuery, type MatchingSelection } from './SelectAllMatching';
import { customSortValue } from '@/lib/crm-list-sort';
import PrivateRecord from './PrivateRecord';
import InlineEditCell from './InlineEditCell';
import { IndexColGroup, sizedTable, useIndexColumns } from './EditColumns';
import RecordPreview from './RecordPreview';
import { PreviewNav, useListNav } from './RecordNav';
import { useCrmLive } from './useCrmLive';
import { ExpandToggle, RowExpansionRow, useRowExpansion } from './RowExpansion';
import TagDots, { type TagDot } from './TagDots';
import CrmIcon from './CrmIcon';
import PhoneTouch from './PhoneTouch';
import CompanyLogo from './CompanyLogo';
import type { BulkEditField } from './BulkEditControls';
import BulkActionsBar from './BulkActionsBar';
import RecordNameCell from './RecordNameCell';
import type { CustomCell, CustomColumn } from './customFieldViews';
import { OwnerCell } from './TableExtraColumns';
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
  /** Borrar y exportar en masa: solo admins (el server lo vuelve a chequear). */
  canDelete?: boolean;
  canExport?: boolean;
  /** Cuántos registros muestra el listado (para "Seleccionar todos los que coinciden"). */
  total?: number;
}


/** Tabla de empresas con selección múltiple, bulk bar, selector de columnas, edición inline y preview. */
export default function CompaniesTable({ rows, sort, lifecycles, locale, allTags = [], bulkFields = [], customColumns = [], owners = [], canDelete = false, canExport = false, total = 0 }: CompaniesTableProps) {
  const t = useTranslations('crm');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  // Orden, columna fija y anchos: los de la página (TableColumnsProvider), los mismos que "Editar columnas".
  const cols = useIndexColumns()!;
  const order = cols.order;
  const sized = sizedTable(cols);
  const [previewId, setPreviewId] = useState<string | null>(null);
  // Ficha y vista previa caminan por estas filas (con sus filtros y su orden); un compañero que cambia una
  // de ellas (o crea una que esta persona ve) la refresca sola. La firma solo cuenta lo que ella ve.
  const navIds = useMemo(() => rows.map((r) => r.id), [rows]);
  useListNav('companies', navIds);
  useCrmLive({ list: 'companies', ids: navIds });
  // Filas desplegadas (asociados y última actividad, como la vista previa de fila de HubSpot).
  const rowIdList = navIds;
  const expansion = useRowExpansion('company', rowIdList);

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

  const lifecycleOpts = lifecycles.map((v) => ({ value: v, label: t(`enums.lifecycle.${v}`) }));

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
            name={row.name} expand={<ExpandToggle id={row.id} name={row.name} expanded={expansion.open.has(row.id)} onToggle={() => expansion.toggle(row.id)} />}
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
              options={lifecycleOpts}
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

      <TableScroll>
        <table className={`table crm-table crm-cards${cols.freeze ? ' is-frozen' : ''}${sized.className}`} style={sized.style}>
          <IndexColGroup cols={cols} />
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
                  kind="company"
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
        <RecordPreview
          type="company"
          id={previewId}
          locale={locale}
          owners={owners}
          onClose={() => setPreviewId(null)}
          nav={<PreviewNav ids={navIds} id={previewId} onStep={setPreviewId} />}
        />
      )}
    </>
  );
}
