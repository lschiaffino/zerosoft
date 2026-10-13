'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';

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

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="app-title">{title}</h1>
          <p className="muted app-sub">{t('sequences.sub')}</p>
        </div>
        <button type="button" className="btn btn-solid btn-small" onClick={() => setOpen(true)}>
          {t('sequences.newCta')}
          <span className="kbd-hint" aria-hidden>
            C
          </span>
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0 0 0 0 0
          </p>
          <h2>{t('sequences.emptyTitle')}</h2>
          <p className="muted">{t('sequences.emptySub')}</p>
          <button type="button" className="btn btn-solid btn-small" onClick={() => setOpen(true)}>
            {t('sequences.emptyCta')}
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table crm-table">
            <thead>
              <tr>
                <th>{t('sequences.name')}</th>
                <th className="th-num">{t('sequences.steps')}</th>
                <th className="th-num">{t('sequences.active')}</th>
                <th className="th-num">{t('sequences.enrolled')}</th>
                <th>{t('sequences.updated')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/app/crm/sequences/${r.id}`} className="cell-name">
                      {r.name}
                    </Link>
                  </td>
                  <td className="mono td-num">{r.steps}</td>
                  <td className="mono td-num">{r.active}</td>
                  <td className="mono td-num">{r.total}</td>
                  <td className="mono muted cell-date">{r.updated}</td>
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
        submitLabel={t('common.create')}
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
          maxLength={200}
          data-autofocus
        />
        <p className="muted qm-note">{t('sequences.cronNote')}</p>
      </QuickModal>
    </>
  );
}
