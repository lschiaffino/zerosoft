'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';

export interface SequenceRowView {
  id: string;
  name: string;
  steps: number;
  active: number;
  total: number;
  updated: string;
}

/** Lista de secuencias + alta rápida (QuickModal, tecla C) → abre el editor. */
export default function SequencesIndex({ rows, title }: { rows: SequenceRowView[]; title: string }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useKeyShortcut('c', () => setOpen(true), !open);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const res = await fetch('/api/crm/sequences', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        timezone,
        steps: [{ type: 'email', subject: '', body: '' }, { type: 'wait', waitDays: 3 }, { type: 'email', body: '' }],
      }),
    }).catch(() => null);
    setBusy(false);
    const data = (await res?.json().catch(() => null)) as { sequence?: { id: string } } | null;
    if (!res?.ok || !data?.sequence) {
      setError(t('errors.generic'));
      return;
    }
    router.push(`/app/crm/sequences/${data.sequence.id}`);
  }

  const createButton = (
    <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} data-testid="sequence-new">
      {rows.length === 0 ? t('sequences.emptyCta') : t('sequences.newCta')}
      <kbd className="kbd" aria-hidden="true">
        C
      </kbd>
    </button>
  );

  return (
    <>
      <PageHeader title={title} description={t('sequences.sub')} actions={rows.length > 0 ? createButton : undefined} />

      {rows.length === 0 ? (
        <EmptyState title={t('sequences.emptyTitle')} body={t('sequences.emptySub')} action={createButton} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{t('sequences.name')}</th>
                <th scope="col" className="num">
                  {t('sequences.steps')}
                </th>
                <th scope="col" className="num">
                  {t('sequences.active')}
                </th>
                <th scope="col" className="num">
                  {t('sequences.enrolled')}
                </th>
                <th scope="col">{t('sequences.updated')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/app/crm/sequences/${r.id}`} className="cell-link">
                      {r.name}
                    </Link>
                  </td>
                  <td className="num">{r.steps}</td>
                  <td className="num">{r.active}</td>
                  <td className="num">{r.total}</td>
                  <td className="data">{r.updated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QuickModal
        open={open}
        onClose={() => setOpen(false)}
        crumb={`CRM › ${t('sequences.crumbNew')}`}
        onSubmit={create}
        submitLabel={t('sequences.createSubmit')}
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
          placeholder={t('sequences.name')}
          aria-label={t('sequences.name')}
          maxLength={200}
          data-autofocus
        />
        <p className="muted qm-note">{t('sequences.createNote')}</p>
      </QuickModal>
    </>
  );
}
