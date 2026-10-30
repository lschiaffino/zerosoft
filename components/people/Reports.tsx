'use client';

import { useLocale, useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { AuditEntry, PeopleReport } from '@/lib/people';
import { Bar, useDay, useNumber } from './people-ui';

function Breakdown({ title, rows, label }: { title: string; rows: Array<{ key: string; count: number }>; label: (k: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="ppl-panel">
      <h2 className="ppl-panel-title">{title}</h2>
      <ul className="ppl-bars">
        {rows.map((r) => (
          <li key={r.key || '_'}>
            <span className="ppl-bars-label">{label(r.key)}</span>
            <Bar value={r.count} max={max} label={`${label(r.key)}: ${r.count}`} />
            <span className="ppl-bars-num">{r.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Reports({ report, audit }: { report: PeopleReport; audit: AuditEntry[] }) {
  const t = useTranslations('people');
  const locale = useLocale();
  const num = useNumber();
  const day = useDay();
  const none = t('reports.none');
  const maxMonth = Math.max(1, ...report.monthly.map((m) => Math.max(m.hires, m.exits)));
  const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' });
  return (
    <div className="app-page ui-page ppl-page">
      <PageHeader
        title={t('nav.reports')}
        description={t('reports.desc')}
        actions={
          <a className="btn btn-secondary" href="/api/people/export" download>
            {t('reports.payroll')}
          </a>
        }
      />
      <div className="ppl-cards">
        <div className="ppl-card">
          <span className="ppl-card-label">{t('reports.headcount')}</span>
          <span className="ppl-card-value" data-testid="people-headcount">
            {report.headcount}
          </span>
        </div>
        <div className="ppl-card">
          <span className="ppl-card-label">{t('reports.turnover')}</span>
          <span className="ppl-card-value">{report.turnover12m == null ? none : `${num(report.turnover12m, 1)}%`}</span>
          <span className="ppl-card-meta">{t('reports.turnoverHint')}</span>
        </div>
        <div className="ppl-card">
          <span className="ppl-card-label">{t('reports.tenure')}</span>
          <span className="ppl-card-value">{t('reports.years', { n: num(report.tenure.average, 1) })}</span>
        </div>
      </div>
      <div className="ppl-grid">
        <Breakdown title={t('reports.byDepartment')} rows={report.byDepartment} label={(k) => k || none} />
        <Breakdown title={t('reports.byLocation')} rows={report.byLocation} label={(k) => k || none} />
        <Breakdown title={t('reports.byType')} rows={report.byType} label={(k) => (k ? t(`types.${k}`) : none)} />
        <Breakdown title={t('reports.tenureBuckets')} rows={report.tenure.buckets} label={(k) => t(`reports.buckets.${k}`)} />
      </div>
      <section className="ppl-panel">
        <h2 className="ppl-panel-title">{t('reports.hiresExits')}</h2>
        <div className="table-wrap">
          <table className="table ppl-table">
            <thead>
              <tr>
                <th scope="col">{t('reports.month')}</th>
                <th scope="col">{t('reports.hires')}</th>
                <th scope="col">{t('reports.exits')}</th>
                <th scope="col" className="num">
                  {t('reports.headcount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.monthly.map((m) => (
                <tr key={m.month}>
                  <th scope="row">{monthLabel(m.month)}</th>
                  <td>
                    <span className="ppl-inline-bar">
                      <Bar value={m.hires} max={maxMonth} label={`${t('reports.hires')}: ${m.hires}`} /> {m.hires}
                    </span>
                  </td>
                  <td>
                    <span className="ppl-inline-bar">
                      <Bar value={m.exits} max={maxMonth} label={`${t('reports.exits')}: ${m.exits}`} /> {m.exits}
                    </span>
                  </td>
                  <td className="num">{m.headcount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ppl-panel">
        <h2 className="ppl-panel-title">{t('reports.timeOff', { year: report.asOf.slice(0, 4) })}</h2>
        {report.timeOff.length === 0 ? (
          <EmptyState compact quiet body={t('timeoff.noPolicies')} />
        ) : (
          <ul className="ppl-bars">
            {report.timeOff.map((r) => (
              <li key={r.policy}>
                <span className="ppl-bars-label">{r.policy}</span>
                <Bar value={r.days} max={Math.max(1, ...report.timeOff.map((x) => x.days))} label={`${r.policy}: ${r.days}`} />
                <span className="ppl-bars-num">{t('reports.daysRequests', { days: num(r.days), requests: r.requests })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="ppl-panel">
        <h2 className="ppl-panel-title">{t('reports.audit')}</h2>
        <p className="ppl-hint">{t('reports.auditHint')}</p>
        {audit.length === 0 ? (
          <EmptyState compact quiet body={t('reports.auditEmpty')} />
        ) : (
          <div className="table-wrap">
            <table className="table table-compact ppl-table" data-testid="people-audit">
              <thead>
                <tr>
                  <th scope="col">{t('reports.when')}</th>
                  <th scope="col">{t('reports.who')}</th>
                  <th scope="col">{t('reports.what')}</th>
                  <th scope="col">{t('reports.whose')}</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td>{day(a.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td>{a.actorName}</td>
                    <td>
                      {t(`reports.actions.${a.action}`)} · {a.field}
                      {a.via !== 'app' && <span className="ppl-muted"> ({a.via})</span>}
                    </td>
                    <td>{a.employeeName ?? ''}</td>
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
