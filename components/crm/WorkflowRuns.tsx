'use client';

import LocalText from '@/components/ui/LocalText';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { WorkflowRunView } from '@/lib/crm-workflows';
import EmptyState from '@/components/ui/EmptyState';
import { parseDbUtc } from '@/lib/utils';

const TONE: Record<string, string> = { done: 'badge-ok', failed: 'badge-bad', running: 'badge-info', waiting: 'badge-info', pending: '' };
const RECORD_PATH = { contact: 'contacts', company: 'companies', deal: 'deals' } as const;

/**
 * Historial de inscripciones de un workflow: cuándo, qué registro, estado
 * (con "sigue el…" si está en una espera) y cuántas acciones salieron bien.
 * Llega ya filtrado por lo que la persona ve y sin la salida de las acciones.
 */
export default function WorkflowRuns({ runs }: { runs: WorkflowRunView[] }) {
  const t = useTranslations('crm.workflows');
  const locale = useLocale();
  const fmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <section className="wf-runs" aria-labelledby="wf-runs-title">
      <h2 className="crm-panel-title" id="wf-runs-title">
        {t('runs')}
      </h2>
      {runs.length === 0 ? (
        <EmptyState compact body={t('noRunsBody')} />
      ) : (
        <div className="table-wrap">
          <table className="table table-compact" data-testid="workflow-runs">
            <caption className="sr-only">{t('runs')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('runWhen')}</th>
                <th scope="col">{t('runRecord')}</th>
                <th scope="col">{t('runState')}</th>
                <th scope="col" className="num">
                  {t('runResult')}
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} data-status={run.status}>
                  <td className="data">
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
