'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { FormDto } from '@/lib/forms/core';
import type { FormSummary as Summary } from '@/lib/forms/responses';
import { FormTabs } from './ui';

function Bars({ items, total, label, unit }: { items: Array<{ key: string; label: string; count: number }>; total: number; label: string; unit?: 'avgPos' }) {
  const t = useTranslations('forms.summary');
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className="fm-bars" aria-label={label}>
      {items.map((i) => {
        const pct = unit ? 0 : total ? Math.round((i.count / total) * 100) : 0;
        return (
          <li key={i.key}>
            <span className="fm-bar-label">{i.label}</span>
            <span className="fm-bar" aria-hidden="true">
              <span style={{ width: `${unit ? (i.count ? 100 - ((i.count - 1) / Math.max(1, items.length - 1)) * 80 : 0) : (i.count / max) * 100}%` }} />
            </span>
            <span className="fm-bar-n">{unit ? t('avgPos', { n: i.count }) : t('countPct', { n: i.count, pct })}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Resumen: respuestas, tasa de finalización, gráficos por pregunta, NPS y abandono por pregunta. */
export default function FormSummary({ form, summary }: { form: FormDto; summary: Summary }) {
  const t = useTranslations('forms.summary');
  const maxDay = Math.max(1, ...summary.byDay.map((d) => d.count));
  return (
    <div className="app-page ui-page fm-page">
      <PageHeader title={form.name} description={t('desc')} back={{ href: '/app/forms', label: t('back') }} />
      <FormTabs id={form.id} active="summary" />
      <div className="fm-stats">
        <div className="fm-stat">
          <span className="fm-stat-n">{summary.total}</span>
          <span className="fm-stat-l">{t('responses')}</span>
        </div>
        <div className="fm-stat">
          <span className="fm-stat-n">{summary.visits}</span>
          <span className="fm-stat-l">{t('visits')}</span>
        </div>
        <div className="fm-stat">
          <span className="fm-stat-n">{summary.completionRate}%</span>
          <span className="fm-stat-l">{t('completion')}</span>
        </div>
        <div className="fm-stat">
          <span className="fm-stat-n">{summary.partials}</span>
          <span className="fm-stat-l">{t('partials')}</span>
        </div>
      </div>
      {summary.byDay.length > 0 && (
        <section className="fm-card" aria-labelledby="fm-days">
          <h2 id="fm-days" className="fm-h2">
            {t('perDay')}
          </h2>
          <ol className="fm-days">
            {summary.byDay.map((d) => (
              <li key={d.day} title={`${d.day}: ${d.count}`}>
                <span className="fm-day-bar" style={{ height: `${(d.count / maxDay) * 100}%` }} aria-hidden="true" />
                <span className="sr-only">
                  {d.day}: {d.count}
                </span>
              </li>
            ))}
          </ol>
          <div className="fm-days-axis" aria-hidden="true">
            <span>{summary.byDay[0].day}</span>
            <span>{t('maxPerDay', { n: maxDay })}</span>
            {summary.byDay.length > 1 && <span>{summary.byDay[summary.byDay.length - 1].day}</span>}
          </div>
        </section>
      )}
      {summary.total === 0 ? (
        <EmptyState product="forms" title={t('emptyTitle')} body={t('emptyBody')} action={{ label: t('share'), href: `/app/forms/${form.id}/share` }} />
      ) : (
        summary.questions.map((q, i) => (
          <section key={q.id} className="fm-card" aria-labelledby={`fm-sum-${q.id}`}>
            <h2 id={`fm-sum-${q.id}`} className="fm-h2">
              {i + 1}. {q.title || q.ref}
            </h2>
            <p className="fm-dim">{t('answered', { n: q.answered, total: summary.total })}</p>
            {q.nps && (
              <div className="fm-nps">
                <span className="fm-stat-n">{q.nps.score}</span>
                <span>{t('nps', { p: q.nps.promoters, n: q.nps.passives, d: q.nps.detractors })}</span>
              </div>
            )}
            {q.average !== undefined && q.average !== null && <p>{t('average', { n: q.average })}</p>}
            {q.counts && <Bars items={q.counts} total={q.answered} label={q.title} unit={q.type === 'ranking' ? 'avgPos' : undefined} />}
            {q.matrix && (
              <div className="table-wrap">
                <table className="table fm-matrix-sum">
                  <thead>
                    <tr>
                      <td />
                      {q.matrix[0]?.counts.map((c) => (
                        <th key={c.label} scope="col">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {q.matrix.map((r) => (
                      <tr key={r.row}>
                        <th scope="row">{r.row}</th>
                        {r.counts.map((c) => (
                          <td key={c.label} className="num">
                            {c.count}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {q.samples && q.samples.length > 0 && (
              <ul className="fm-samples">
                {q.samples.map((s, k) => (
                  <li key={k}>{s}</li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
      <section className="fm-card" aria-labelledby="fm-drop">
        <h2 id="fm-drop" className="fm-h2">
          {t('dropOff')}
        </h2>
        <p className="fm-dim">{t('dropOffHelp')}</p>
        {summary.visits === 0 ? (
          <p className="fm-dim">{t('noVisits')}</p>
        ) : (
          <ul className="fm-bars" aria-label={t('dropOff')}>
            {summary.dropOff.map((d, i) => (
              <li key={d.id}>
                <span className="fm-bar-label">{d.id === '__completed' ? t('completed') : `${i + 1}. ${d.title}`}</span>
                <span className="fm-bar" aria-hidden="true">
                  <span style={{ width: `${d.rate}%` }} />
                </span>
                <span className="fm-bar-n">{t('reached', { n: d.reached, pct: d.rate })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
