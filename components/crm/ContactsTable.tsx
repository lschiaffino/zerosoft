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
import BulkEditControls, { type BulkEditField } from './BulkEditControls';
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
}

const COLS = [
  { id: 'name', labelKey: 'contacts.table.name', defaultVisible: true },
  { id: 'email', labelKey: 'contacts.table.email', defaultVisible: true },
  { id: 'phone', labelKey: 'contacts.table.phone', defaultVisible: true },
  { id: 'company', labelKey: 'contacts.table.company', defaultVisible: true },
  { id: 'lifecycle', labelKey: 'contacts.table.lifecycle', defaultVisible: true },
  { id: 'leadStatus', labelKey: 'contacts.table.leadStatus', defaultVisible: true },
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
export default function ContactsTable({
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
}: ContactsTableProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const columnDefs = [
    ...COLS.map((c) => ({ id: c.id, label: t(c.labelKey), defaultVisible: c.defaultVisible })),
    ...customColumns.map((c) => ({ id: c.id, label: c.label, defaultVisible: false })),
  ];
  const [visible, toggleVisible] = useColumnVisibility(
    columnDefs,
    'zs-contacts-columns',
  );
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [bulkSequence, setBulkSequence] = useState('');
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  /** Acción masiva: inscribir los seleccionados en una secuencia. */
  async function enrollSelected() {
    if (!bulkSequence) return;
    setBusy(true);
    setBulkNotice(null);
    const res = await fetch(`/api/crm/sequences/${bulkSequence}/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactIds: [...selected] }),
    }).catch(() => null);
    setBusy(false);
    const data = (await res?.json().catch(() => null)) as { error?: string; enrolled?: string[]; skipped?: unknown[] } | null;
    if (!res?.ok) {
      setBulkNotice(data?.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}` as 'errors.generic') : t('errors.generic'));
      return;
    }
    const skipped = data?.skipped?.length ?? 0;
    setBulkNotice(
      `${t('sequences.enrolledOk', { count: data?.enrolled?.length ?? 0 })}${skipped ? ` ${t('sequences.enrolledSkipped', { count: skipped })}` : ''}`,
    );
    setSelected(new Set());
    setBulkSequence('');
  }

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

  const lifecycleOpts = lifecycles.map((v) => ({ value: v, label: t(`enums.lifecycle.${v}`) }));
  const leadStatusOpts = leadStatuses.map((v) => ({ value: v, label: t(`enums.leadStatus.${v}`) }));
  const sourceOpts = sources.map((v) => ({ value: v, label: t(`enums.source.${v}`) }));

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
                  onChange={toggleAll}
                  aria-label={t('common.all')}
                />
              </th>
              {visible.has('name') && (
                <th data-card="main">
                  <SortTh label={t('contacts.table.name')} asc="name" desc="name_desc" current={sort} />
                </th>
              )}
              {visible.has('email') && (
                <th>
                  <SortTh label={t('contacts.table.email')} asc="email" desc="email_desc" current={sort} />
                </th>
              )}
              {visible.has('phone') && <th>{t('contacts.table.phone')}</th>}
              {visible.has('company') && <th>{t('contacts.table.company')}</th>}
              {visible.has('lifecycle') && <th>{t('contacts.table.lifecycle')}</th>}
              {visible.has('leadStatus') && <th>{t('contacts.table.leadStatus')}</th>}
              {visible.has('source') && <th>{t('contacts.table.source')}</th>}
              {visible.has('score') && (
                <th className="num">
                  <SortTh label={t('scoring.column')} asc="score_asc" desc="score" current={sort} />
                </th>
              )}
              {visible.has('tags') && <th>{t('tags.column')}</th>}
              {visible.has('owner') && <OwnerHeader sort={sort} />}
              {visible.has('created') && (
                <th className="num cell-date">
                  <SortTh label={t('contacts.table.created')} asc="oldest" desc="newest" current={sort} />
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
              <th className="cell-actions-head"><span className="sr-only">{t('contacts.table.actions')}</span></th>
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
                    <Link href={`/app/crm/contacts/${row.id}`} className="cell-name">
                      {row.name}
                    </Link>
                  </td>
                )}
                {visible.has('email') && (
                  <td data-card="line">
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
                )}
                {visible.has('phone') && (
                  <td className="cell-sub" data-card="line">
                    <InlineEditCell
                      endpoint={`/api/crm/contacts/${row.id}`}
                      field="phone"
                      value={row.phone}
                      displayValue={formatPhoneDisplay(row.phone)}
                      className="muted"
                    />
                    {row.phone ? <PhoneTouch phone={row.phone} contactId={row.id} compact /> : null}
                  </td>
                )}
                {visible.has('company') && (
                  <td data-card="line">
                    {companies.length > 0 ? (
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
                )}
                {visible.has('lifecycle') && (
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
                )}
                {visible.has('leadStatus') && (
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
                )}
                {visible.has('source') && (
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
                )}
                {visible.has('score') && (
                  <td className="num cell-score" data-testid="contact-score">
                    {row.score}
                    {row.scoreTier && <span className="score-tier" data-testid="contact-score-tier">{row.scoreTier}</span>}
                  </td>
                )}
                {visible.has('tags') && (
                  <td className="cell-crm-tags">
                    <TagDots tags={row.tags ?? []} max={2} />
                  </td>
                )}
                {visible.has('owner') && (
                  <OwnerCell endpoint={`/api/crm/contacts/${row.id}`} ownerId={row.ownerId} owners={owners} />
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
          <span className="bulk-count">{t('contacts.bulk.selected', { count: selected.size })}</span>
          <BulkEditControls
            endpoint="/api/crm/contacts/bulk"
            ids={[...selected]}
            fields={bulkFields}
            disabled={busy}
            onDone={(notice) => {
              setSelected(new Set());
              setBulkNotice(notice);
            }}
          />
          <TagBulkControls
            entity="contact"
            ids={[...selected]}
            tags={allTags}
            disabled={busy}
            onDone={() => setSelected(new Set())}
          />
          {sequences.length > 0 && (
            <>
              <select
                className="filter-select"
                value={bulkSequence}
                onChange={(e) => setBulkSequence(e.target.value)}
                aria-label={t('contacts.bulk.enroll')}
                disabled={busy}
              >
                <option value="">{t('contacts.bulk.enroll')}</option>
                {sequences.map((sq) => (
                  <option key={sq.id} value={sq.id}>
                    {sq.name}
                  </option>
                ))}
              </select>
              <button type="button" className="bulk-btn" disabled={busy || !bulkSequence} onClick={enrollSelected}>
                {t('sequences.enrollCta')}
              </button>
            </>
          )}
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
