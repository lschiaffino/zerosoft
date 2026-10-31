'use client';

import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { HiringReport } from '@/lib/hiring/reports';

export default function HiringReports({ report, jobs }: { report: HiringReport; jobs: Array<{ id: string; title: string }> }) {
  const t = useTranslations('hiring');
  const router = useRouter();
  const go = (days: number, job: string | null) => router.push(`/app/hiring/reports?days=${days}${job ? `&job=${job}` : ''}`);
  const max = Math.max(1, ...report.funnel.map((f) => f.reached));
  return (
    <div className="app-page ui-page hr-page">
      <PageHeader title={t('nav.reports')} description={t('reports.desc')} />
      <div className="hr-toolbar">
        <select className="select hr-filter" aria-label={t('reports.period')} value={report.days} onChange={(e) => go(Number(e.target.value), report.jobId)}>
          {[30, 90, 180, 365].map((d) => (
            <option key={d} value={d}>
              {t('reports.lastDays', { days: d })}
            </option>
          ))}
        </select>
        <select className="select hr-filter" aria-label={t('filters.job')} value={report.jobId ?? ''} onChange={(e) => go(report.days, e.target.value || null)}>
          <option value="">{t('filters.allJobs')}</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title}
            </option>
          ))}
        </select>
      </div>

      <div className="hr-stats">
        <div className="panel hr-stat">
          <span className="hr-stat-label">{t('reports.timeToHire')}</span>
          <span className="hr-stat-value" data-testid="hr-time-to-hire">
            {report.timeToHire.avgDays == null ? t('reports.noData') : t('reports.days', { days: report.timeToHire.avgDays })}
          </span>
          <span className="hr-stat-sub">{t('reports.median', { days: report.timeToHire.medianDays ?? '·', hires: report.timeToHire.hires })}</span>
        </div>
        <div className="panel hr-stat">
          <span className="hr-stat-label">{t('reports.openJobs')}</span>
          <span className="hr-stat-value">{report.openJobs.length}</span>
          <span className="hr-stat-sub">{t('reports.activeCandidates', { count: report.openJobs.reduce((s, j) => s + j.active, 0) })}</span>
        </div>
        <div className="panel hr-stat">
          <span className="hr-stat-label">{t('reports.applications')}</span>
          <span className="hr-stat-value">{report.funnel[0]?.reached ?? 0}</span>
          <span className="hr-stat-sub">{t('reports.lastDays', { days: report.days })}</span>
        </div>
      </div>

      <section className="panel hr-report" aria-labelledby="hr-funnel">
        <h2 id="hr-funnel" className="hr-panel-title">
          {t('reports.funnel')}
        </h2>
        <table className="table hr-table">
          <caption className="sr-only">{t('reports.funnel')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('reports.stage')}</th>
              <th scope="col">{t('reports.reached')}</th>
              <th scope="col" className="num">
                {t('reports.conversion')}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.funnel.map((f) => (
              <tr key={f.key}>
                <th scope="row">{f.label}</th>
                <td>
                  <span className="hr-bar" aria-hidden="true">
                    <span style={{ width: `${(f.reached / max) * 100}%` }} />
                  </span>
                  <span className="hr-bar-num">{f.reached}</span>
                </td>
                <td className="num">{f.rate == null ? '·' : `${f.rate}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel hr-report" aria-labelledby="hr-sources">
        <h2 id="hr-sources" className="hr-panel-title">
          {t('reports.sources')}
        </h2>
        {report.sources.length === 0 ? (
          <p className="ui-help">{t('reports.noData')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table hr-table">
              <thead>
                <tr>
                  <th scope="col">{t('candidates.colSource')}</th>
                  <th scope="col" className="num">
                    {t('reports.applications')}
                  </th>
                  <th scope="col" className="num">
                    {t('reports.interviews')}
                  </th>
                  <th scope="col" className="num">
                    {t('reports.hires')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.sources.map((s) => (
                  <tr key={s.source}>
                    <th scope="row">{t.has(`sources.${s.source}`) ? t(`sources.${s.source}`) : s.source}</th>
                    <td className="num">{s.applications}</td>
                    <td className="num">{s.interviews}</td>
                    <td className="num">{s.hires}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel hr-report" aria-labelledby="hr-open">
        <h2 id="hr-open" className="hr-panel-title">
          {t('reports.openJobs')}
        </h2>
        {report.openJobs.length === 0 ? (
          <p className="ui-help">{t('overview.noOpenJobs')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table hr-table">
              <thead>
                <tr>
                  <th scope="col">{t('jobs.colTitle')}</th>
                  <th scope="col" className="num">
                    {t('reports.daysOpen')}
                  </th>
                  <th scope="col" className="num">
                    {t('reports.active')}
                  </th>
                  <th scope="col" className="num">
                    {t('reports.total')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.openJobs.map((j) => (
                  <tr key={j.id}>
                    <th scope="row">
                      <Link href={`/app/hiring/jobs/${j.id}`}>{j.title}</Link>
                    </th>
                    <td className="num">{j.daysOpen}</td>
                    <td className="num">{j.active}</td>
                    <td className="num">{j.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
