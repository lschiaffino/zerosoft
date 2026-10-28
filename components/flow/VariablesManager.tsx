'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import QuickModal from '@/components/app/QuickModal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import type { FlowVariableDto } from '@/lib/flow-variables';

interface Props {
  variables: FlowVariableDto[];
  canEdit: boolean;
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Variables propias (/app/flow/variables): las leen con {{vars.clave}} los flows que corren con tu acceso. */
export default function VariablesManager({ variables: initial, canEdit }: Props) {
  const t = useTranslations('flow.variables');
  const tf = useTranslations('flow');
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<FlowVariableDto | 'new' | null>(null);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FlowVariableDto | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  function open(v: FlowVariableDto | 'new') {
    setEditing(v);
    setKey(v === 'new' ? '' : v.key);
    setValue(v === 'new' ? '' : v.value);
    setError(null);
  }

  async function save() {
    if (!editing) return;
    const k = key.trim();
    if (!KEY_RE.test(k)) {
      setError(t('errors.invalid_key'));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(editing === 'new' ? '/api/flow/variables' : `/api/flow/variables/${editing.id}`, {
      method: editing === 'new' ? 'POST' : 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: k, value }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { variable?: FlowVariableDto; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !data?.variable) {
      const code = data?.error ?? 'generic';
      setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : tf('errors.generic'));
      return;
    }
    const saved = data.variable;
    setList((l) => [...l.filter((x) => x.id !== saved.id), saved].sort((a, b) => a.key.localeCompare(b.key)));
    setEditing(null);
  }

  async function remove(v: FlowVariableDto) {
    setBusy(true);
    const res = await fetch(`/api/flow/variables/${v.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    setDeleting(null);
    if (!res?.ok) {
      setPageError(tf('errors.generic'));
      return;
    }
    setList((l) => l.filter((x) => x.id !== v.id));
  }

  async function copyRef(k: string) {
    try {
      await navigator.clipboard.writeText(`{{vars.${k}}}`);
      setCopied(k);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // Sin permiso de portapapeles: la referencia se ve en la tabla.
    }
  }

  const create = canEdit ? (
    <button type="button" className="btn btn-primary" onClick={() => open('new')}>
      {t('create')}
    </button>
  ) : null;

  return (
    <div className="ui-page flow-page">
      <PageHeader back={{ href: '/app/flow', label: tf('title') }} title={t('title')} description={t('subtitle')} actions={list.length > 0 ? create : undefined} />
      <p className="ui-help">{t('scopeHint')}</p>
      {!canEdit && <p className="ui-help">{tf('list.adminOnly')}</p>}
      {pageError && (
        <p className="ui-error" role="alert">
          {pageError}
        </p>
      )}
      <DataTable
        caption={t('title')}
        className="flow-table flow-table-vars"
        rows={list}
        rowKey={(v) => v.id}
        empty={<EmptyState title={t('emptyTitle')} body={t('emptyBody')} action={create} />}
        columns={[
          {
            key: 'key',
            header: t('key'),
            data: true,
            cell: (v) => (
              <button type="button" className="flow-link data" onClick={() => void copyRef(v.key)} title={t('copyRef')}>
                {`{{vars.${v.key}}}`}
                {copied === v.key ? ` · ${tf('editor.copied')}` : ''}
              </button>
            ),
          },
          { key: 'value', header: t('value'), data: true, cell: (v) => <span className="flow-ellipsis flow-muted">{v.value}</span> },
          {
            key: 'actions',
            header: <span className="sr-only">{tf('list.actions')}</span>,
            width: '1%',
            cell: (v) =>
              canEdit ? (
                <span className="flow-row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`${t('edit')} ${v.key}`} onClick={() => open(v)}>
                    {t('edit')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-danger btn-sm" aria-label={`${t('delete')} ${v.key}`} onClick={() => setDeleting(v)}>
                    {t('delete')}
                  </button>
                </span>
              ) : null,
          },
        ]}
      />

      <QuickModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? t('create') : t('edit')}
        onSubmit={() => void save()}
        submitLabel={tf('editor.save')}
        cancelLabel={tf('editor.cancel')}
        submitDisabled={!key.trim()}
        busy={busy}
        error={error}
        width={480}
      >
        <div className="ui-field">
          <label className="label" htmlFor="flow-var-key">
            {t('key')}
          </label>
          <input
            id="flow-var-key"
            className="input data"
            value={key}
            maxLength={64}
            placeholder="api_base"
            autoComplete="off"
            onChange={(e) => setKey(e.target.value)}
          />
          <p className="ui-help">{t('keyHint')}</p>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="flow-var-value">
            {t('value')}
          </label>
          <textarea id="flow-var-value" className="textarea" rows={3} value={value} maxLength={10_000} onChange={(e) => setValue(e.target.value)} />
          <p className="ui-help">{t('valueHint')}</p>
        </div>
      </QuickModal>

      <ConfirmDialog
        open={deleting !== null}
        danger
        busy={busy}
        title={t('deleteTitle')}
        body={deleting ? t('confirmDelete', { key: deleting.key }) : null}
        confirmLabel={t('delete')}
        cancelLabel={tf('editor.cancel')}
        onConfirm={() => deleting && void remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
