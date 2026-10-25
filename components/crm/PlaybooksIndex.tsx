'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

export interface PlaybookRowView {
  id: string;
  name: string;
  questions: number;
  entities: string;
  uses: number;
  updated: string;
}

/**
 * Lista de playbooks y alta rápida (QuickModal, tecla C) que abre el editor.
 * Cada fila se renombra en línea (Enter guarda, Esc cancela) y se borra con confirmación.
 */
export default function PlaybooksIndex({ rows: initialRows, title, canEdit }: { rows: PlaybookRowView[]; title: string; canEdit: boolean }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [synced, setSynced] = useState(initialRows);
  if (synced !== initialRows) {
    setSynced(initialRows);
    setRows(initialRows);
  }
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirm, setConfirm] = useState<PlaybookRowView | null>(null);
  const [rowBusy, setRowBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useKeyShortcut('c', () => setOpen(true), canEdit && !open);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/playbooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), body: t('playbooks.starterBody') }),
    }).catch(() => null);
    setBusy(false);
    const data = (await res?.json().catch(() => null)) as { id?: string } | null;
    if (!res?.ok || !data?.id) {
      setError(t('playbooks.saveError'));
      return;
    }
    router.push(`/app/crm/playbooks/${data.id}`);
  }

  async function rename() {
    const target = renaming;
    if (!target?.name.trim() || rowBusy) return;
    const current = rows.find((r) => r.id === target.id);
    if (current?.name === target.name.trim()) {
      setRenaming(null);
      return;
    }
    setRowBusy(true);
    setRowError(null);
    const res = await fetch(`/api/crm/playbooks/${target.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: target.name.trim() }),
    }).catch(() => null);
    setRowBusy(false);
    if (!res?.ok) {
      setRowError(t('playbooks.saveError'));
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === target.id ? { ...r, name: target.name.trim() } : r)));
    setRenaming(null);
    router.refresh();
  }

  async function remove(row: PlaybookRowView) {
    setRowBusy(true);
    setRowError(null);
    const res = await fetch(`/api/crm/playbooks/${row.id}`, { method: 'DELETE' }).catch(() => null);
    setRowBusy(false);
    setConfirm(null);
    if (!res?.ok) {
      setRowError(t('playbooks.deleteError'));
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    router.refresh();
  }

  const createButton = canEdit ? (
    <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} data-testid="playbook-new">
      {t('playbooks.new')}
      <kbd className="kbd" aria-hidden="true">
        C
      </kbd>
    </button>
  ) : undefined;

  return (
    <>
      <PageHeader title={title} description={t('playbooks.sub')} actions={rows.length > 0 ? createButton : undefined} />

      {rows.length === 0 ? (
        <EmptyState title={t('playbooks.emptyTitle')} body={t('playbooks.emptyBody')} action={createButton} />
      ) : (
        <div className="table-wrap">
          <table className="table crm-stack">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{t('playbooks.name')}</th>
                <th scope="col" className="num">
                  {t('playbooks.questions')}
                </th>
                <th scope="col">{t('playbooks.availableIn')}</th>
                <th scope="col" className="num">
                  {t('playbooks.uses')}
                </th>
                <th scope="col">{t('playbooks.updated')}</th>
                {canEdit && (
                  <th scope="col">
                    <span className="sr-only">{t('common.actions')}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid="playbook-row">
                  <td className="crm-stack-main">
                    {renaming?.id === r.id ? (
                      <form
                        className="media-rename"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void rename();
                        }}
                      >
                        <input
                          className="input"
                          autoFocus
                          value={renaming.name}
                          aria-label={t('playbooks.rename')}
                          maxLength={200}
                          onChange={(e) => setRenaming({ id: r.id, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.stopPropagation();
                              setRenaming(null);
                            }
                          }}
                          data-testid="playbook-rename-input"
                        />
                        <button type="submit" className="btn btn-secondary btn-sm" disabled={rowBusy || !renaming.name.trim()}>
                          {t('common.save')}
                        </button>
                      </form>
                    ) : (
                      <Link href={`/app/crm/playbooks/${r.id}`} className="cell-link">
                        {r.name}
                      </Link>
                    )}
                  </td>
                  <td className="num" data-label={t('playbooks.questions')}>
                    {r.questions}
                  </td>
                  <td data-label={t('playbooks.availableIn')}>{r.entities}</td>
                  <td className="num" data-label={t('playbooks.uses')}>
                    {r.uses}
                  </td>
                  <td className="data" data-label={t('playbooks.updated')}>
                    {r.updated}
                  </td>
                  {canEdit && (
                    <td className="media-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setRenaming({ id: r.id, name: r.name })}
                        data-testid="playbook-row-rename"
                        aria-label={`${t('playbooks.rename')}: ${r.name}`}
                      >
                        {t('playbooks.rename')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-danger btn-sm"
                        onClick={() => setConfirm(r)}
                        data-testid="playbook-row-delete"
                        aria-label={`${t('playbooks.deleteShort')}: ${r.name}`}
                      >
                        {t('playbooks.deleteShort')}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rowError && (
        <p className="form-error" role="alert">
          {rowError}
        </p>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? t('playbooks.deleteTitle', { name: confirm.name }) : ''}
        body={t('playbooks.deleteBody')}
        confirmLabel={t('playbooks.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={rowBusy}
        onConfirm={() => confirm && void remove(confirm)}
        onCancel={() => setConfirm(null)}
      />

      <QuickModal
        open={open}
        onClose={() => setOpen(false)}
        crumb={`CRM › ${t('playbooks.crumbNew')}`}
        onSubmit={create}
        submitLabel={t('playbooks.createSubmit')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!name.trim()}
        busy={busy}
        error={error}
        hint={t('quick.hint')}
      >
        <input
          className="qm-title"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('playbooks.name')}
          aria-label={t('playbooks.name')}
          maxLength={200}
          data-autofocus
        />
      </QuickModal>
    </>
  );
}
