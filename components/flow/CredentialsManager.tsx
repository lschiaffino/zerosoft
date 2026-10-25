'use client';

import { useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import type { CredentialDto } from '@/lib/flow-credentials';
import CredentialDialog from './CredentialDialog';
import { parseDbUtc } from '@/lib/utils';

interface Props {
  credentials: CredentialDto[];
  canEdit: boolean;
}

/** Credenciales del workspace (/app/flow/credentials): alta, edición y baja. Los secretos no se muestran nunca. */
export default function CredentialsManager({ credentials: initial, canEdit }: Props) {
  const t = useTranslations('flow.credentials');
  const tf = useTranslations('flow');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [list, setList] = useState(initial);
  const [dialog, setDialog] = useState<{ editing: CredentialDto | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(c: CredentialDto) {
    if (!window.confirm(t('confirmDelete', { name: c.name }))) return;
    setBusyId(c.id);
    setError(null);
    const res = await fetch(`/api/flow/credentials/${c.id}`, { method: 'DELETE' }).catch(() => null);
    setBusyId(null);
    if (!res?.ok) {
      setError(tf('errors.generic'));
      return;
    }
    setList((l) => l.filter((x) => x.id !== c.id));
  }

  function onSaved(saved: CredentialDto) {
    setList((l) =>
      l.some((c) => c.id === saved.id)
        ? l.map((c) => (c.id === saved.id ? saved : c))
        : [...l, saved].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setDialog(null);
  }

  const create = canEdit ? (
    <button type="button" className="btn btn-primary" onClick={() => setDialog({ editing: null })}>
      {t('create')}
    </button>
  ) : null;

  return (
    <div className="ui-page flow-page">
      <PageHeader
        back={{ href: '/app/flow', label: tf('title') }}
        title={t('title')}
        description={t('subtitle')}
        actions={list.length > 0 ? create : undefined}
      />
      {!canEdit && <p className="ui-help">{t('adminOnly')}</p>}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      <DataTable
        caption={t('listTitle')}
        className="flow-table flow-table-creds"
        rows={list}
        rowKey={(c) => c.id}
        empty={<EmptyState title={t('emptyTitle')} body={t('emptyHint')} action={create} />}
        columns={[
          { key: 'name', header: t('name'), cell: (c) => c.name, data: true },
          { key: 'type', header: t('type'), cell: (c) => t(`types.${c.type}`) },
          {
            key: 'value',
            header: t('value'),
            data: true,
            cell: (c) => (
              <span className="flow-muted flow-ellipsis">{[...Object.values(c.fields).filter(Boolean), c.hint].filter(Boolean).join(' · ') || ''}</span>
            ),
          },
          {
            key: 'updated',
            header: t('updated'),
            cell: (c) => (
              <span className="flow-muted" suppressHydrationWarning>
                {format.relativeTime(parseDbUtc(c.updatedAt), now)}
              </span>
            ),
          },
          {
            key: 'actions',
            header: <span className="sr-only">{tf('editor.settings')}</span>,
            width: '1%',
            cell: (c) =>
              canEdit ? (
                <span className="flow-row-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label={`${t('edit')} ${c.name}`}
                    onClick={() => setDialog({ editing: c })}
                  >
                    {t('edit')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-danger btn-sm"
                    aria-label={`${t('delete')} ${c.name}`}
                    aria-busy={busyId === c.id || undefined}
                    onClick={() => void remove(c)}
                  >
                    {t('delete')}
                  </button>
                </span>
              ) : null,
          },
        ]}
      />

      <CredentialDialog
        open={dialog !== null}
        editing={dialog?.editing ?? null}
        existingNames={list.map((c) => c.name)}
        onClose={() => setDialog(null)}
        onSaved={onSaved}
      />
    </div>
  );
}
