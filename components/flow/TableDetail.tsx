'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import AdvancedSection from '@/components/ui/AdvancedSection';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import type { FlowTableDto, FlowTableRowDto } from '@/lib/flow-tables';
import { MAX_TABLE_ROWS, type FlowTableColumn } from '@/lib/flow-tables-schema';
import TableColumnsEditor from './TableColumnsEditor';
import { useTableError } from './TablesManager';

interface Props {
  table: FlowTableDto;
  rows: FlowTableRowDto[];
  total: number;
  canEdit: boolean;
}

const PAGE = 100;

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : String(v);
}

/** Una tabla de datos (/app/flow/tables/[id]): sus filas, alta, edición y baja; columnas en Avanzado. */
export default function TableDetail({ table: initial, rows: initialRows, total: initialTotal, canEdit }: Props) {
  const t = useTranslations('flow.tables');
  const tf = useTranslations('flow');
  const format = useFormatter();
  const errorText = useTableError();
  const [table, setTable] = useState(initial);
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [name, setName] = useState(initial.name);
  const [columns, setColumns] = useState<FlowTableColumn[]>(initial.columns);
  const [schemaMsg, setSchemaMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [editing, setEditing] = useState<FlowTableRowDto | 'new' | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const open = editing !== null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  function openRow(row: FlowTableRowDto | 'new') {
    const next: Record<string, string> = {};
    for (const c of table.columns) next[c.name] = row === 'new' ? '' : cellText(row[c.name]);
    setValues(next);
    setRowError(null);
    setEditing(row);
  }

  async function saveRow() {
    if (!editing) return;
    setBusy(true);
    setRowError(null);
    const isNew = editing === 'new';
    const res = await fetch(isNew ? `/api/flow/tables/${table.id}/rows` : `/api/flow/tables/${table.id}/rows/${editing.id}`, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: values }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { row?: FlowTableRowDto; error?: string; column?: string } | null;
    setBusy(false);
    if (!res?.ok || !data?.row) {
      setRowError(errorText(data?.error, data?.column));
      return;
    }
    const saved = data.row;
    if (isNew) {
      setRows((r) => [saved, ...r]);
      setTotal((n) => n + 1);
    } else setRows((r) => r.map((x) => (x.id === saved.id ? saved : x)));
    setEditing(null);
  }

  async function removeRow(row: FlowTableRowDto) {
    if (!window.confirm(t('confirmDeleteRow'))) return;
    setListError(null);
    const res = await fetch(`/api/flow/tables/${table.id}/rows/${row.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setListError(tf('errors.generic'));
      return;
    }
    setRows((r) => r.filter((x) => x.id !== row.id));
    setTotal((n) => Math.max(0, n - 1));
  }

  async function loadMore() {
    setListError(null);
    const res = await fetch(`/api/flow/tables/${table.id}/rows?limit=${PAGE}&offset=${rows.length}`).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { rows?: FlowTableRowDto[]; total?: number } | null;
    if (!data?.rows) {
      setListError(tf('errors.generic'));
      return;
    }
    const more = data.rows;
    setRows((r) => [...r, ...more.filter((m) => !r.some((x) => x.id === m.id))]);
    if (typeof data.total === 'number') setTotal(data.total);
  }

  async function saveSchema() {
    setBusy(true);
    setSchemaMsg(null);
    const res = await fetch(`/api/flow/tables/${table.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, columns: columns.filter((c) => c.name.trim()) }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { table?: FlowTableDto; error?: string; column?: string } | null;
    setBusy(false);
    if (!res?.ok || !data?.table) {
      setSchemaMsg({ kind: 'error', text: errorText(data?.error, data?.column) });
      return;
    }
    const removed = table.columns.filter((c) => !data.table!.columns.some((n) => n.name === c.name));
    setTable(data.table);
    setColumns(data.table.columns);
    setName(data.table.name);
    if (removed.length) {
      // Las columnas quitadas dejan de leerse: la vista se refresca sin ellas.
      setRows((r) => r.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !removed.some((c) => c.name === k))) as FlowTableRowDto));
    }
    setSchemaMsg({ kind: 'ok', text: t('saved') });
  }

  const addButton =
    canEdit && table.columns.length > 0 ? (
      <button type="button" className="btn btn-primary" onClick={() => openRow('new')} disabled={total >= MAX_TABLE_ROWS}>
        {t('addRow')}
      </button>
    ) : null;

  return (
    <div className="ui-page flow-page">
      <PageHeader
        back={{ href: '/app/flow/tables', label: t('title') }}
        title={table.name}
        description={t('rowCount', { n: total, max: format.number(MAX_TABLE_ROWS) })}
        actions={rows.length > 0 ? addButton : undefined}
      />
      <p className="ui-help">{t('useHint', { id: table.id })}</p>
      {listError && (
        <p className="ui-error" role="alert">
          {listError}
        </p>
      )}
      <DataTable
        caption={table.name}
        className="flow-table"
        rows={rows}
        rowKey={(r) => r.id}
        empty={
          <EmptyState
            title={t('emptyRowsTitle')}
            body={table.columns.length ? t('emptyRowsHint') : t('noColumnsHint')}
            action={addButton}
          />
        }
        columns={[
          ...table.columns.map((c) => ({
            key: `c-${c.name}`,
            header: c.name,
            numeric: c.type === 'number',
            data: c.type !== 'boolean',
            cell: (r: FlowTableRowDto) => {
              const v = r[c.name];
              if (c.type === 'boolean') return v === true ? t('yes') : v === false ? t('no') : '';
              // Números con el formato del idioma (1.500,5 en es); el editor sigue usando el valor crudo.
              const num = c.type === 'number' && v !== null && v !== '' ? Number(v) : NaN;
              if (Number.isFinite(num)) {
                return <span className="flow-ellipsis">{format.number(num, { maximumFractionDigits: 20 })}</span>;
              }
              return <span className="flow-ellipsis">{cellText(v)}</span>;
            },
          })),
          {
            key: 'actions',
            header: <span className="sr-only">{tf('editor.settings')}</span>,
            width: '1%',
            cell: (r: FlowTableRowDto) =>
              canEdit ? (
                <span className="flow-row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => openRow(r)}>
                    {t('edit')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => void removeRow(r)}>
                    {t('delete')}
                  </button>
                </span>
              ) : null,
          },
        ]}
      />
      {rows.length < total && (
        <button type="button" className="btn btn-secondary btn-sm flow-more" onClick={() => void loadMore()}>
          {t('loadMore', { n: total - rows.length })}
        </button>
      )}

      {canEdit && (
        <AdvancedSection storageKey="flow.table" defaultOpen={table.columns.length === 0}>
          <div className="ui-fields flow-table-schema">
            <div className="ui-field">
              <label className="label" htmlFor="flow-table-name">
                {t('name')}
              </label>
              <input id="flow-table-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="ui-field">
              <p className="label">{t('columns')}</p>
              <TableColumnsEditor idPrefix="flow-table-col" columns={columns} onChange={setColumns} />
              <p className="ui-help">{t('removeColumnHint')}</p>
            </div>
            <div className="flow-test-actions">
              <button type="button" className="btn btn-secondary btn-sm" aria-busy={busy || undefined} onClick={() => void saveSchema()}>
                {t('saveColumns')}
              </button>
              {schemaMsg && (
                <span className={schemaMsg.kind === 'error' ? 'ui-error' : 'ui-help'} role="status">
                  {schemaMsg.text}
                </span>
              )}
            </div>
          </div>
        </AdvancedSection>
      )}

      <dialog
        ref={ref}
        className="ui-modal"
        aria-labelledby="flow-row-title"
        onClose={() => setEditing(null)}
        onCancel={(e) => {
          e.preventDefault();
          setEditing(null);
        }}
      >
        {open && (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void saveRow();
            }}
          >
            <div className="ui-modal-head">
              <h2 id="flow-row-title" className="ui-modal-title">
                {editing === 'new' ? t('newRow') : t('editRow')}
              </h2>
            </div>
            <div className="ui-modal-body ui-fields">
              {table.columns.map((c, i) => (
                <div className="ui-field" key={c.name}>
                  <label className="label" htmlFor={`flow-row-${c.name}`}>
                    {c.name} <span className="ui-optional">· {t(`types.${c.type}`)}</span>
                  </label>
                  {c.type === 'boolean' ? (
                    <select
                      id={`flow-row-${c.name}`}
                      className="select"
                      value={values[c.name] ?? ''}
                      onChange={(e) => setValues({ ...values, [c.name]: e.target.value })}
                    >
                      <option value="">{t('empty')}</option>
                      <option value="true">{t('yes')}</option>
                      <option value="false">{t('no')}</option>
                    </select>
                  ) : (
                    <input
                      id={`flow-row-${c.name}`}
                      className="input data"
                      inputMode={c.type === 'number' ? 'decimal' : undefined}
                      autoFocus={i === 0}
                      value={values[c.name] ?? ''}
                      onChange={(e) => setValues({ ...values, [c.name]: e.target.value })}
                    />
                  )}
                </div>
              ))}
              {rowError && (
                <p className="ui-error" role="alert">
                  {rowError}
                </p>
              )}
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                {tf('editor.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>
                {t('saveRow')}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
