'use client';

import LocalText from '@/components/ui/LocalText';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { RecordEnrollment } from '@/lib/crm-workflows';
import { parseDbUtc } from '@/lib/utils';

const TONE: Record<string, string> = { done: 'badge-ok', failed: 'badge-bad', running: 'badge-info', waiting: 'badge-info', pending: '', unenrolled: '' };
const ACTIVE = new Set(['waiting', 'running', 'pending']);

/**
 * Historial de inscripciones del registro en workflows (como "Workflows" en
 * la ficha de HubSpot): nombre del workflow, estado y fecha. La ficha ya
 * comprobó que la persona ve el registro; acá no sale la salida de las acciones.
 * Owner y admins (W3) pueden sacar el registro de un workflow en el que sigue.
 */
export default function RecordWorkflows({ enrollments, canEdit = false }: { enrollments: RecordEnrollment[]; canEdit?: boolean }) {
  const t = useTranslations('crm.workflows');
  const locale = useLocale();
  const router = useRouter();
  const fmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!enrollments.length) return <p className="ui-help">{t('recordCard.empty')}</p>;

  async function unenroll(e: RecordEnrollment) {
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/crm/workflows/${e.workflow_id}/enrollments/${e.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    setConfirming(null);
    if (!res?.ok) setError(true);
    router.refresh();
  }

  return (
    <>
      <ul className="crm-record-workflows" data-testid="record-workflows">
        {enrollments.map((e) => (
          <li key={e.id} className="crm-record-workflow" data-status={e.status}>
            <Link href={`/app/crm/workflows/${e.workflow_id}`} className="crm-record-workflow-name">
              {e.workflow_name}
            </Link>
            <span className="crm-record-workflow-meta">
              <span className={`badge ${TONE[e.status] ?? ''}`.trim()}>
                {t.has(`runStatus.${e.status}`) ? t(`runStatus.${e.status}` as 'runStatus.done') : e.status}
              </span>
              <LocalText>
                {e.resume_at ? t('recordCard.resumes', { when: fmt.format(parseDbUtc(e.resume_at)) }) : fmt.format(parseDbUtc(e.started_at))}
              </LocalText>
            </span>
            {canEdit && ACTIVE.has(e.status) && (
              <span className="crm-record-workflow-actions" onKeyDown={(k) => k.key === 'Escape' && setConfirming(null)}>
                {confirming === e.id ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary btn-danger btn-sm"
                      onClick={() => void unenroll(e)}
                      disabled={busy}
                      aria-busy={busy || undefined}
                      data-testid="record-workflow-unenroll-confirm"
                    >
                      {t('runLog.unenrollConfirm')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)}>
                      {t('cancel')}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setConfirming(e.id)} data-testid="record-workflow-unenroll">
                    {t('runLog.unenroll')}
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="ui-error" role="alert">
          {t('runLog.unenrollError')}
        </p>
      )}
    </>
  );
}
