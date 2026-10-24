'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';

export interface PlaybookRowView {
  id: string;
  name: string;
  questions: number;
  entities: string;
  uses: number;
  updated: string;
}

/** Lista de playbooks y alta rápida (QuickModal, tecla C) que abre el editor. */
export default function PlaybooksIndex({ rows, title, canEdit }: { rows: PlaybookRowView[]; title: string; canEdit: boolean }) {
  const t = useTranslations('crm');
  const router = useRouter();
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid="playbook-row">
                  <td className="crm-stack-main">
                    <Link href={`/app/crm/playbooks/${r.id}`} className="cell-link">
                      {r.name}
                    </Link>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
