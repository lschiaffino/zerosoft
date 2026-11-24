'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
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
import { ExpandToggle, RowExpansionRow, useRowExpansion } from './RowExpansion';
import TagDots, { type TagDot } from './TagDots';
import CrmIcon from './CrmIcon';
import PhoneTouch from './PhoneTouch';
import type { BulkEditField } from './BulkEditControls';
import BulkActionsBar from './BulkActionsBar';
import RecordNameCell from './RecordNameCell';
import type { CustomCell, CustomColumn } from './customFieldViews';
import { OwnerCell } from './TableExtraColumns';
import { useCrmOptions } from './CrmViewer';
import { formatPhoneDisplay } from '@/lib/crm-calls';

export interface ContactRow {
  id: string;
  /** Owner (id de usuario) para la columna editable. */
  ownerId?: string | null;
  /** Custom fields ya formateados (`custom:<name>`). */
  custom?: Record<string, CustomCell>;
  name: string;
  email: string;
  phone: string;
  companyName: string | null;
  companyId: string | null;
  /** La empresa primaria es un registro que la persona no ve. */
  companyPrivate?: boolean;
  lifecycle: string;
  leadStatus: string;
  source: string;
  /** Lead score (lib/crm-scoring.ts). */
  score: number;
  /** Tramo del score principal según sus umbrales (Hot, Warm…). */
  scoreTier?: string;
  created: string;
  /** Fechas de actividad ya formateadas ('' = sin fecha). */
  lastActivity?: string;
  lastContacted?: string;
  nextActivity?: string;
  tags?: TagDot[];
}

interface Option {
  value: string;
  label: string;
}

interface ContactsTableProps {
  rows: ContactRow[];
  /** Columnas de custom fields (ocultas por defecto). */
  customColumns?: CustomColumn[];
  sources: string[];
  sort: string;
  companies?: Option[];
  locale: string;
  /** Secuencias para la acción masiva "Inscribir en secuencia". */
  sequences?: Array<{ id: string; name: string }>;
  /** Tags del workspace (bulk add/remove). */
  allTags?: Array<{ id: string; name: string }>;
  /** Propiedades editables en masa (owner, lifecycle, custom fields…). */
  bulkFields?: BulkEditField[];
  /** Personas del workspace (columna owner). */
  owners?: Array<{ value: string; label: string }>;
  /** Listas estáticas de contactos (acción masiva "Agregar a lista"). */
  lists?: Array<{ id: string; name: string }>;
  /** Borrar y exportar en masa: solo admins (el server lo vuelve a chequear). */
  canDelete?: boolean;
  canExport?: boolean;
  /** Cuántos registros muestra el listado (para "Seleccionar todos los que coinciden"). */
  total?: number;
}


/** Tabla de contactos con selección múltiple, bulk bar, selector de columnas, edición inline y preview. */
export default function ContactsTable({
  rows,
  sources,
  sort,
  companies = [],
  locale,
  sequences = [],
  allTags = [],
  bulkFields = [],
  customColumns = [],
  owners = [],
  lists = [],
  canDelete = false,
  canExport = false,
  total = 0,
}: ContactsTableProps) {
  const t = useTranslations('crm');
  const crmOpts = useCrmOptions();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Orden, columna fija y anchos: los de la página (TableColumnsProvider), los mismos que "Editar columnas".
  const cols = useIndexColumns()!;
  const order = cols.order;
  const sized = sizedTable(cols);
  const [previewId, setPreviewId] = useState<string | null>(null);
  // Filas desplegadas (asociados y última actividad, como la vista previa de fila de HubSpot).
  const rowIdList = rows.map((r) => r.id);
  const expansion = useRowExpansion('contact', rowIdList);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

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

  const sourceOpts = sources.map((v) => ({ value: v, label: t(`enums.source.${v}`) }));

  // Encabezados con el menú de columna (ordenar, mover, quitar), como en HubSpot.
  const H = (id: string, label: string, opts: { asc?: string; desc?: string; className?: string; card?: string } = {}) => (
    <HeaderCell id={id} label={label} sort={sort} {...opts} />
  );
  const headCells: Record<string, ReactNode> = {
    name: H('name', t('contacts.table.name'), { asc: 'name', desc: 'name_desc', card: 'main' }),
    email: H('email', t('contacts.table.email'), { asc: 'email', desc: 'email_desc' }),
    phone: H('phone', t('contacts.table.phone')),
    company: H('company', t('contacts.table.company')),
    lifecycle: H('lifecycle', t('contacts.table.lifecycle')),
    leadStatus: H('leadStatus', t('contacts.table.leadStatus')),
    source: H('source', t('contacts.table.source')),
    score: H('score', t('scoring.column'), { asc: 'score_asc', desc: 'score', className: 'num' }),
    tags: H('tags', t('tags.column')),
    owner: H('owner', t('filters.field.owner'), { asc: 'owner', desc: 'owner_desc' }),
    created: H('created', t('contacts.table.created'), { asc: 'oldest', desc: 'newest', className: 'num cell-date' }),
    lastActivity: H('lastActivity', t('activityDates.lastActivity'), { asc: 'last_activity_asc', desc: 'last_activity', className: 'num cell-date' }),
    lastContacted: H('lastContacted', t('activityDates.lastContacted'), { asc: 'last_contacted_asc', desc: 'last_contacted', className: 'num cell-date' }),
    nextActivity: H('nextActivity', t('activityDates.nextActivity'), { asc: 'next_activity', desc: 'next_activity_desc', className: 'num cell-date' }),
  };
  for (const c of customColumns) {
    const name = c.id.startsWith('custom:') ? c.id.slice(7) : c.id;
    headCells[c.id] = H(c.id, c.label, { asc: customSortValue(name), desc: customSortValue(name, true), className: c.numeric ? 'num' : undefined });
  }
  const customById = new Map(customColumns.map((c) => [c.id, c]));

  function bodyCell(id: string, row: ContactRow): ReactNode {
    switch (id) {
      case 'name':
        return <RecordNameCell href={`/app/crm/contacts/${row.id}`} name={row.name} onPreview={() => setPreviewId(row.id)}
            expand={<ExpandToggle id={row.id} name={row.name} expanded={expansion.open.has(row.id)} onToggle={() => expansion.toggle(row.id)} />}
          />;
      case 'email':
        return (
          <td className="card-contact-email" data-card="line">
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
                aria-label={t('enums.activityType.email')}
              >
                <CrmIcon name="mail" />
              </a>
            ) : null}
          </td>
        );
      case 'phone':
        return (
          <td className="cell-sub card-contact-phone" data-card="line">
            <InlineEditCell
              endpoint={`/api/crm/contacts/${row.id}`}
              field="phone"
              value={row.phone}
              displayValue={formatPhoneDisplay(row.phone)}
              className="muted"
            />
            {row.phone ? <PhoneTouch phone={row.phone} contactId={row.id} compact /> : null}
          </td>
        );
      case 'company':
        return (
          <td data-card="line">
            {row.companyPrivate ? (
              // No se ofrece cambiarla: la pisaría sin verla.
              <PrivateRecord label={t('common.privateRecord')} />
            ) : companies.length > 0 ? (
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
              <span className="muted cell-empty">—</span>
            )}
          </td>
        );
      case 'lifecycle':
        return (
          <td data-card="state">
            <InlineEditCell
              endpoint={`/api/crm/contacts/${row.id}`}
              field="lifecycleStage"
              value={row.lifecycle}
              type="select"
              options={crmOpts.choices('lifecycle', row.lifecycle)}
              className={`dot-label stage-${row.lifecycle}`}
            />
          </td>
        );
      case 'leadStatus':
        return (
          <td>
            <InlineEditCell
              endpoint={`/api/crm/contacts/${row.id}`}
              field="leadStatus"
              value={row.leadStatus}
              type="select"
              options={crmOpts.choices('leadStatus', row.leadStatus)}
              className="dot-label"
            />
          </td>
        );
      case 'source':
        return (
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
        );
      case 'score':
        return (
          <td className="num cell-score" data-testid="contact-score">
            {row.score}
            {row.scoreTier && <span className="score-tier" data-testid="contact-score-tier">{row.scoreTier}</span>}
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
          <OwnerCell endpoint={`/api/crm/contacts/${row.id}`} ownerId={row.ownerId} owners={owners} />
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
      {allSelected && (
        <SelectAllMatching
          entity="contacts"
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
                  kind="contact"
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
          entity="contact"
          ids={[...selected]}
          matching={liveMatching ? { query: liveMatching.query, count: liveMatching.count } : undefined}
          owners={owners}
          bulkFields={bulkFields}
          allTags={allTags}
          lists={lists}
          sequences={sequences}
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
        <RecordPreview type="contact" id={previewId} locale={locale} owners={owners} onClose={() => setPreviewId(null)} />
      )}
    </>
  );
}
