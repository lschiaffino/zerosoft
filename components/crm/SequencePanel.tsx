'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';

export interface ContactEnrollment {
  id: string;
  sequenceId: string;
  sequenceName: string;
  status: 'active' | 'paused' | 'finished' | 'exited';
  exitReason: string | null;
  step: number;
  stepCount: number;
}

/** Detalle de contacto: secuencias en las que está (pausar / quitar) + inscribir. */
export default function SequencePanel({
  contactId,
  sequences,
  enrollments,
}: {
  contactId: string;
  sequences: Array<{ id: string; name: string }>;
  enrollments: ContactEnrollment[];
}) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = new Set(enrollments.filter((e) => e.status === 'active' || e.status === 'paused').map((e) => e.sequenceId));
  const options = sequences.filter((s) => !live.has(s.id));

  async function enroll() {
    if (!pick || busy) return;
    setBusy('enroll');
    setError(null);
    const res = await fetch(`/api/crm/sequences/${pick}/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactIds: [contactId] }),
    }).catch(() => null);
    setBusy(null);
    const data = (await res?.json().catch(() => null)) as { error?: string; enrolled?: string[]; skipped?: Array<{ reason: string }> } | null;
    if (!res?.ok) {
      setError(data?.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}` as 'errors.generic') : t('errors.generic'));
      return;
    }
    if (!data?.enrolled?.length) {
      const reason = data?.skipped?.[0]?.reason;
      setError(reason && t.has(`errors.${reason}`) ? t(`errors.${reason}` as 'errors.generic') : t('sequences.enrolledSkipped', { count: 1 }));
      return;
    }
    setPick('');
    router.refresh();
  }

  async function act(id: string, action: 'pause' | 'resume' | 'exit') {
    setBusy(id);
    await fetch(`/api/crm/sequences/enrollments/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    setBusy(null);
    router.refresh();
  }

  return (
    <section className="panel seq-panel">
      <p className="section-label">{t('sequences.panelTitle')}</p>
      {enrollments.length === 0 ? (
        <p className="muted">{t('sequences.panelEmpty')}</p>
      ) : (
        <ul className="seq-enr-list">
          {enrollments.map((e) => (
            <li key={e.id} className={busy === e.id ? 'row-busy' : undefined}>
              <div className="seq-enr-main">
                <Link href={`/app/crm/sequences/${e.sequenceId}`} className="cell-name">
                  {e.sequenceName}
                </Link>
                <span className={`seq-status s-${e.status} mono`}>
                  {t(`sequences.statuses.${e.status}`)}
                  {e.status === 'active' || e.status === 'paused'
                    ? ` · ${t('sequences.stepOf', { n: e.step, total: e.stepCount })}`
                    : e.exitReason && t.has(`sequences.reasons.${e.exitReason}`)
                      ? ` · ${t(`sequences.reasons.${e.exitReason}` as 'sequences.reasons.manual')}`
                      : ''}
                </span>
              </div>
              {(e.status === 'active' || e.status === 'paused') && (
                <div className="seq-enr-actions">
                  <button type="button" className="link-btn" onClick={() => act(e.id, e.status === 'active' ? 'pause' : 'resume')}>
                    {e.status === 'active' ? t('sequences.pause') : t('sequences.resume')}
                  </button>
                  <button type="button" className="link-btn danger" onClick={() => act(e.id, 'exit')}>
                    {t('sequences.exit')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {options.length > 0 && (
        <div className="seq-enroll">
          <select className="filter-select" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t('sequences.enrollPick')}>
            <option value="">{t('sequences.enrollPick')}</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-small" disabled={!pick || busy !== null} onClick={enroll}>
            {t('sequences.enrollCta')}
          </button>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
