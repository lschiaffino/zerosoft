'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import type { FlowTableDto } from '@/lib/flow-tables';
import { MAX_TABLE_ROWS, type FlowTableColumn } from '@/lib/flow-tables-schema';
import TableColumnsEditor from './TableColumnsEditor';
import { parseDbUtc } from '@/lib/utils';

interface Props {
  tables: FlowTableDto[];
  canEdit: boolean;
}

/** Mensaje de un error de las rutas de tablas (flow.tables.errors.*). */
export function useTableError() {
  const t = useTranslations('flow.tables');
  const tf = useTranslations('flow');
  return (code: string | undefined, column?: string) =>
    code && t.has(`errors.${code}`) ? t(`errors.${code}`, { column: column ?? '' }) : tf('errors.generic');
}

/** Tablas de datos del workspace (/app/flow/tables): alta y baja. Cada tabla se edita en su página. */
export default function TablesManager({ tables: initial, canEdit }: Props) {
  const t = useTranslations('flow.tables');
  const tf = useTranslations('flow');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const router = useRouter();
  const errorText = useTableError();
  const [list, setList] = useState(initial);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [columns, setColumns] = useState<FlowTableColumn[]>([{ name: 'key', type: 'text' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  function openCreate() {
    setName('');
    setColumns([{ name: 'key', type: 'text' }]);
    setError(null);
    setOpen(true);
  }

  async function create() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/flow/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, columns: columns.filter((c) => c.name.trim()) }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { table?: FlowTableDto; error?: string; column?: string } | null;
    setBusy(false);
    if (!res?.ok || !data?.table) {
      setError(errorText(data?.error, data?.column));
      return;
    }
    setOpen(false);
    router.push(`/app/flow/tables/${data.table.id}`);
  }

  async function remove(table: FlowTableDto) {
    if (!window.confirm(t('confirmDelete', { name: table.name }))) return;
    setListError(null);
    const res = await fetch(`/api/flow/tables/${table.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setListError(tf('errors.generic'));
      return;
    }
    setList((l) => l.filter((x) => x.id !== table.id));
  }

  const createButton = canEdit ? (
    <button type="button" className="btn btn-primary" onClick={openCreate}>
      {t('create')}
    </button>
  ) : null;

  return (
    <div className="ui-page flow-page">
      <PageHeader
        back={{ href: '/app/flow', label: tf('title') }}
        title={t('title')}
        description={t('subtitle', { rows: format.number(MAX_TABLE_ROWS) })}
        actions={list.length > 0 ? createButton : undefined}
      />
      {!canEdit && <p className="ui-help">{t('adminOnly')}</p>}
      {listError && (
        <p className="ui-error" role="alert">
          {listError}
        </p>
      )}
      <DataTable
        caption={t('title')}
        className="flow-table"
        rows={list}
        rowKey={(x) => x.id}
        rowHref={(x) => `/app/flow/tables/${x.id}`}
        empty={<EmptyState title={t('emptyTitle')} body={t('emptyHint')} action={createButton} />}
        columns={[
          { key: 'name', header: t('name'), cell: (x) => x.name },
          {
            key: 'columns',
            header: t('columns'),
            data: true,
            cell: (x) => <span className="flow-muted flow-ellipsis">{x.columns.map((c) => c.name).join(', ')}</span>,
          },
          { key: 'rows', header: t('rows'), numeric: true, cell: (x) => format.number(x.rowCount) },
          {
            key: 'updated',
            header: t('updated'),
            cell: (x) => (
              <span className="flow-muted" suppressHydrationWarning>
                {format.relativeTime(parseDbUtc(x.updatedAt), now)}
              </span>
            ),
          },
          {
            key: 'actions',
            header: <span className="sr-only">{tf('editor.settings')}</span>,
            width: '1%',
            cell: (x) =>
              canEdit ? (
                <span className="flow-row-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-danger btn-sm"
                    aria-label={`${t('delete')} ${x.name}`}
                    onClick={() => void remove(x)}
                  >
                    {t('delete')}
                  </button>
                </span>
              ) : null,
          },
        ]}
      />

      <dialog
        ref={ref}
        className="ui-modal"
        aria-labelledby="flow-table-new-title"
        onClose={() => setOpen(false)}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
      >
        {open && (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="ui-modal-head">
              <h2 id="flow-table-new-title" className="ui-modal-title">
                {t('newTitle')}
              </h2>
            </div>
            <div className="ui-modal-body ui-fields">
              <div className="ui-field">
                <label className="label" htmlFor="flow-table-name">
                  {t('name')}
                </label>
                <input
                  id="flow-table-name"
                  className="input"
                  value={name}
                  maxLength={60}
                  autoFocus
                  placeholder={t('namePlaceholder')}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="ui-field">
                <p className="label">{t('columns')}</p>
                <TableColumnsEditor idPrefix="flow-table-new-col" columns={columns} onChange={setColumns} />
              </div>
              {error && (
                <p className="ui-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                {tf('editor.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>
                {t('create')}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
