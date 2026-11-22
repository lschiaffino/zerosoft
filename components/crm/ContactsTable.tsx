'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import SortTh from './SortTh';
import PrivateRecord from './PrivateRecord';
import InlineEditCell from './InlineEditCell';
import { EditColumnsInBar, useTableColumns } from './EditColumns';
import RecordPreview from './RecordPreview';
import TagDots, { type TagDot } from './TagDots';
import CrmIcon from './CrmIcon';
import PhoneTouch from './PhoneTouch';
import type { BulkEditField } from './BulkEditControls';
import BulkActionsBar from './BulkActionsBar';
import RecordNameCell from './RecordNameCell';
import type { CustomCell, CustomColumn } from './customFieldViews';
import { CustomColumnHeader, OwnerCell, OwnerHeader } from './TableExtraColumns';
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
  /** Columnas en orden (`cols` de la URL o de la vista activa) y si la primera queda fija. */
  viewCols?: string;
  viewFreeze?: boolean;
  rows: ContactRow[];
  /** Columnas de custom fields (ocultas por defecto). */
  customColumns?: CustomColumn[];
  lifecycles: string[];
  leadStatuses: string[];
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
}

const COLS = [
  { id: 'name', labelKey: 'contacts.table.name', defaultVisible: true },
  { id: 'email', labelKey: 'contacts.table.email', defaultVisible: true },
  { id: 'phone', labelKey: 'contacts.table.phone', defaultVisible: true },
  { id: 'company', labelKey: 'contacts.table.company', defaultVisible: true },
  { id: 'lifecycle', labelKey: 'contacts.table.lifecycle', defaultVisible: true },
  { id: 'leadStatus', labelKey: 'contacts.table.leadStatus', defaultVisible: false },
  { id: 'source', labelKey: 'contacts.table.source', defaultVisible: false },
  { id: 'score', labelKey: 'scoring.column', defaultVisible: false },
  { id: 'tags', labelKey: 'tags.column', defaultVisible: true },
  { id: 'owner', labelKey: 'filters.field.owner', defaultVisible: true },
  { id: 'created', labelKey: 'contacts.table.created', defaultVisible: true },
  { id: 'lastActivity', labelKey: 'activityDates.lastActivity', defaultVisible: false },
  { id: 'lastContacted', labelKey: 'activityDates.lastContacted', defaultVisible: false },
  { id: 'nextActivity', labelKey: 'activityDates.nextActivity', defaultVisible: false },
];

/** Tabla de contactos con selección múltiple, bulk bar, selector de columnas, edición inline y preview. */
export default function ContactsTable({ viewCols, viewFreeze,
  rows,
  lifecycles,
  leadStatuses,
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
}: ContactsTableProps) {
  const t = useTranslations('crm');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const columnDefs = [
    ...COLS.map((c) => ({ id: c.id, label: t(c.labelKey), defaultVisible: c.defaultVisible })),
    ...customColumns.map((c) => ({ id: c.id, label: c.label, defaultVisible: false })),
  ];
  const cols = useTableColumns({ entity: 'contacts', columns: columnDefs, storageKey: 'zs-contacts-columns', first: 'name', viewCols, viewFreeze, defaultFreeze: true });
  const order = cols.order;
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  // Otra página, filtro u orden: la selección se queda solo con las filas que siguen a la vista
  // (la barra masiva nunca actúa sobre registros que ya no se ven).
  const rowIds = rows.map((r) => r.id).join(',');
  useEffect(() => {
    const shown = new Set(rowIds.split(','));
    setSelected((prev) => (prev.size && [...prev].some((id) => !shown.has(id)) ? new Set([...prev].filter((id) => shown.has(id))) : prev));
  }, [rowIds]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
    setBulkNotice(null);
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBulkNotice(null);
  }

  const lifecycleOpts = lifecycles.map((v) => ({ value: v, label: t(`enums.lifecycle.${v}`) }));
  const leadStatusOpts = leadStatuses.map((v) => ({ value: v, label: t(`enums.leadStatus.${v}`) }));
  const sourceOpts = sources.map((v) => ({ value: v, label: t(`enums.source.${v}`) }));

  const headCells: Record<string, ReactNode> = {
    name: (
      <th data-card="main">
        <SortTh label={t('contacts.table.name')} asc="name" desc="name_desc" current={sort} />
      </th>
    ),
    email: (
      <th>
        <SortTh label={t('contacts.table.email')} asc="email" desc="email_desc" current={sort} />
      </th>
    ),
    phone: <th>{t('contacts.table.phone')}</th>,
    company: <th>{t('contacts.table.company')}</th>,
    lifecycle: <th>{t('contacts.table.lifecycle')}</th>,
    leadStatus: <th>{t('contacts.table.leadStatus')}</th>,
    source: <th>{t('contacts.table.source')}</th>,
    score: (
      <th className="num">
        <SortTh label={t('scoring.column')} asc="score_asc" desc="score" current={sort} />
      </th>
    ),
    tags: <th>{t('tags.column')}</th>,
    owner: <OwnerHeader sort={sort} />,
    created: (
      <th className="num cell-date">
        <SortTh label={t('contacts.table.created')} asc="oldest" desc="newest" current={sort} />
      </th>
    ),
    lastActivity: (
      <th className="num cell-date">
        <SortTh label={t('activityDates.lastActivity')} asc="last_activity_asc" desc="last_activity" current={sort} />
      </th>
    ),
    lastContacted: (
      <th className="num cell-date">
        <SortTh label={t('activityDates.lastContacted')} asc="last_contacted_asc" desc="last_contacted" current={sort} />
      </th>
    ),
    nextActivity: (
      <th className="num cell-date">
        <SortTh label={t('activityDates.nextActivity')} asc="next_activity" desc="next_activity_desc" current={sort} />
      </th>
    ),
  };
  for (const c of customColumns) headCells[c.id] = <CustomColumnHeader key={c.id} col={c} sort={sort} />;
  const customById = new Map(customColumns.map((c) => [c.id, c]));

  function bodyCell(id: string, row: ContactRow): ReactNode {
    switch (id) {
      case 'name':
        return <RecordNameCell href={`/app/crm/contacts/${row.id}`} name={row.name} onPreview={() => setPreviewId(row.id)} />;
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
              options={lifecycleOpts}
              className={`badge stage-${row.lifecycle}`}
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
              options={leadStatusOpts}
              className="badge"
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
      <EditColumnsInBar
        columns={columnDefs}
        first="name"
        order={cols.order}
        freeze={cols.freeze}
        onApply={cols.apply}
        onReset={cols.reset}
      />

      <div className="table-wrap">
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
      </div>

      {selected.size > 0 && (
        <BulkActionsBar
          entity="contact"
          ids={[...selected]}
          owners={owners}
          bulkFields={bulkFields}
          allTags={allTags}
          lists={lists}
          sequences={sequences}
          canDelete={canDelete}
          canExport={canExport}
          onClear={() => setSelected(new Set())}
          onNotice={(notice) => {
            setSelected(new Set());
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
        <RecordPreview type="contact" id={previewId} locale={locale} onClose={() => setPreviewId(null)} />
      )}
    </>
  );
}
