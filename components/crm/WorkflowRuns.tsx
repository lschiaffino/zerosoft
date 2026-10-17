'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { CrmWorkflowRunRow } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import { runSummary } from '@/lib/crm-admin-format';

const TONE: Record<string, string> = { done: 'badge-ok', failed: 'badge-bad', running: 'badge-info', pending: '' };

function parseWhen(iso: string): Date {
  return new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
}

/** Historial de ejecuciones de un workflow: tabla densa con estado y resultado. */
export default function WorkflowRuns({ runs }: { runs: CrmWorkflowRunRow[] }) {
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
          <table className="table table-compact">
            <caption className="sr-only">{t('runs')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('runWhen')}</th>
                <th scope="col">{t('runState')}</th>
                <th scope="col" className="num">
                  {t('runResult')}
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const s = runSummary(run.output);
                return (
                  <tr key={run.id}>
                    <td className="data">{fmt.format(parseWhen(run.started_at))}</td>
                    <td>
                      <span className={`badge ${TONE[run.status] ?? ''}`.trim()}>
                        {t.has(`runStatus.${run.status}`) ? t(`runStatus.${run.status}` as 'runStatus.done') : run.status}
                      </span>
                    </td>
                    <td className="num data">{s ? t('runActionsOk', { ok: s.ok, total: s.total }) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
