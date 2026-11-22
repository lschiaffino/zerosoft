'use client';

import LocalText from '@/components/ui/LocalText';
import { Fragment, useState, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { WorkflowRunView } from '@/lib/crm-workflows';
import EmptyState from '@/components/ui/EmptyState';
import { parseDbUtc } from '@/lib/utils';

const TONE: Record<string, string> = { done: 'badge-ok', failed: 'badge-bad', running: 'badge-info', waiting: 'badge-info', pending: '', unenrolled: '' };
const RECORD_PATH = { contact: 'contacts', company: 'companies', deal: 'deals' } as const;
const ACTIVE = new Set(['waiting', 'running', 'pending']);

/**
 * Historial de inscripciones de un workflow: cuándo, qué registro, estado
 * (con "sigue el…" si está en una espera) y cuántas acciones salieron bien.
 * Llega ya filtrado por lo que la persona ve y sin la salida de las acciones.
 * Owner y admins (W3) abren el registro por acción de cada inscripción y
 * pueden sacar un registro que sigue inscripto.
 */
export default function WorkflowRuns({ runs, workflowId, canEdit = false }: { runs: WorkflowRunView[]; workflowId?: string; canEdit?: boolean }) {
  const t = useTranslations('crm.workflows');
  const locale = useLocale();
  const router = useRouter();
  const fmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = canEdit && !!workflowId;
  /** "Esperó 2 días" en la unidad más grande que entra justa. */
  const waited = (minutes: number) => {
    const [n, unit] = minutes % 1440 === 0 ? [minutes / 1440, 'days'] : minutes % 60 === 0 ? [minutes / 60, 'hours'] : [minutes, 'minutes'];
    return t('runLog.waited', { time: t(`delay.summary.${unit}` as 'delay.summary.days', { n }) });
  };
  const actionLabel = (type: string) => (t.has(`actionTypes.${type}`) ? t(`actionTypes.${type}` as 'actionTypes.webhook') : type);

  async function unenroll(runId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/workflows/${workflowId}/enrollments/${runId}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    setConfirming(null);
    if (!res?.ok) {
      setError(t('runLog.unenrollError'));
      return;
    }
    setOpen(null);
    router.refresh();
  }

  const onPanelKey = (e: KeyboardEvent<HTMLElement>, runId: string) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    setConfirming(null);
    setOpen(null);
    document.getElementById(`wf-run-toggle-${runId}`)?.focus();
  };

  return (
    <section className="wf-runs" aria-labelledby="wf-runs-title">
      <h2 className="crm-panel-title" id="wf-runs-title">
        {t('runs')}
      </h2>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {runs.length === 0 ? (
        <EmptyState compact body={t('noRunsBody')} />
      ) : (
        <div className="table-wrap table-stack">
          <table className="table table-compact wf-runs-table" data-testid="workflow-runs">
            <caption className="sr-only">{t('runs')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('runWhen')}</th>
                <th scope="col">{t('runRecord')}</th>
                <th scope="col">{t('runState')}</th>
                <th scope="col" className="num">
                  {t('runResult')}
                </th>
                {admin && (
                  <th scope="col" className="wf-runs-more">
                    <span className="sr-only">{t('runLog.title')}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const isOpen = admin && open === run.id;
                return (
                  <Fragment key={run.id}>
                    <tr data-status={run.status}>
                      <td className="data wf-runs-when">
                        <LocalText>{fmt.format(parseDbUtc(run.started_at))}</LocalText>
                      </td>
                      <td className="wf-runs-record">
                        {run.record ? (
                          <Link href={`/app/crm/${RECORD_PATH[run.record.entity]}/${run.record.id}`}>
                            {run.record.label || t(`entities.${run.record.entity}`)}
                          </Link>
                        ) : (
                          <span className="ui-help">{t('runNoRecord')}</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${TONE[run.status] ?? ''}`.trim()}>
                          {t.has(`runStatus.${run.status}`) ? t(`runStatus.${run.status}` as 'runStatus.done') : run.status}
                        </span>
                        {run.resume_at && (
                          <span className="ui-help wf-runs-resume">
                            {' '}
                            <LocalText>{t('resumesAt', { when: fmt.format(parseDbUtc(run.resume_at)) })}</LocalText>
                          </span>
                        )}
                      </td>
                      <td className="num data">{run.total ? t('runActionsOk', { ok: run.ok, total: run.total }) : ''}</td>
                      {admin && (
                        <td className="wf-runs-more">
                          <button
                            type="button"
                            id={`wf-run-toggle-${run.id}`}
                            className="btn btn-ghost btn-sm wf-runs-toggle"
                            aria-expanded={isOpen}
                            aria-controls={`wf-run-log-${run.id}`}
                            onClick={() => {
                              setConfirming(null);
                              setOpen(isOpen ? null : run.id);
                            }}
                            data-testid="workflow-run-toggle"
                          >
                            {t('runLog.show')}
                          </button>
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <tr className="wf-runs-detail">
                        <td colSpan={5}>
                          <div id={`wf-run-log-${run.id}`} className="wf-run-log" onKeyDown={(e) => onPanelKey(e, run.id)} data-testid="workflow-run-log">
                            {run.log && run.log.length ? (
                              <ol className="wf-run-steps">
                                {run.log.map((s, i) => (
                                  <li key={i} className="wf-run-step" data-outcome={s.outcome}>
                                    <span className="wf-run-step-name">{actionLabel(s.type)}</span>
                                    <span className="wf-run-step-outcome">
                                      {s.branch
                                        ? t(`runLog.branch.${s.branch}`)
                                        : s.outcome === 'waited' && s.minutes
                                          ? waited(s.minutes)
                                          : t(`runLog.outcome.${s.outcome}`)}
                                      {s.error && <span className="data"> {s.error}</span>}
                                    </span>
                                    {s.at && (
                                      <span className="ui-help data wf-run-step-at">
                                        <LocalText>{fmt.format(parseDbUtc(s.at))}</LocalText>
                                      </span>
                                    )}
                                  </li>
                                ))}
                              </ol>
                            ) : (
                              <p className="ui-help">{t('runLog.empty')}</p>
                            )}
                            {run.status === 'unenrolled' && (
                              <p className="ui-help">{run.unenrolledBy ? t('runLog.unenrolledBy', { name: run.unenrolledBy }) : t('runLog.unenrolled')}</p>
                            )}
                            {ACTIVE.has(run.status) && (
                              <div className="wf-run-actions">
                                {confirming === run.id ? (
                                  <>
                                    <button
                                      type="button"
                                      className="btn btn-primary btn-danger btn-sm"
                                      onClick={() => void unenroll(run.id)}
                                      aria-busy={busy || undefined}
                                      disabled={busy}
                                      data-testid="workflow-unenroll-confirm"
                                    >
                                      {t('runLog.unenrollConfirm')}
                                    </button>
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)}>
                                      {t('cancel')}
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-danger btn-sm"
                                    onClick={() => setConfirming(run.id)}
                                    data-testid="workflow-unenroll"
                                  >
                                    {t('runLog.unenroll')}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
