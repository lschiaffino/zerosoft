import { getTranslations } from 'next-intl/server';
import type { RoutingFunnel } from '@/lib/calendar-routing';
import { formatNumber } from '@/lib/utils';

function pct(n: number, of: number, locale: string): string {
  if (!of) return '–';
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(n / of);
}

/**
 * Embudo del routing form (como Routing Analytics de Calendly): envíos →
 * derivados a un tipo de evento → reservaron → siguen en pie, y la
 * conversión de cada regla.
 */
export default async function RoutingFunnelView({
  funnel,
  locale,
  ruleLabels,
}: {
  funnel: RoutingFunnel;
  locale: string;
  /** Nombre visible de cada regla (por id) y del respaldo. */
  ruleLabels: Record<string, string>;
}) {
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const steps = [
    { key: 'submissions', label: t('funnel.submissions'), n: funnel.submissions, of: funnel.submissions },
    { key: 'routed', label: t('funnel.routedToEvent'), n: funnel.routedToEvent, of: funnel.submissions },
    { key: 'booked', label: t('funnel.booked'), n: funnel.booked, of: funnel.routedToEvent },
    { key: 'confirmed', label: t('funnel.confirmed'), n: funnel.confirmed, of: funnel.booked },
  ];
  return (
    <section className="ui-section cal-funnel" aria-labelledby="cal-funnel-title">
      <div className="ui-section-head">
        <h2 id="cal-funnel-title" className="ui-section-title">
          {t('funnel.title')}
        </h2>
        <p className="ui-section-desc">{t('funnel.lead')}</p>
      </div>
      <div className="ui-section-body">
        {funnel.submissions === 0 ? (
          <p className="cal-muted">{t('routing.noSubmissions')}</p>
        ) : (
          <>
            <ol className="cal-funnel-steps">
              {steps.map((s) => (
                <li key={s.key} className="cal-funnel-step">
                  <span className="cal-funnel-label">{s.label}</span>
                  <span className="cal-funnel-n data">{formatNumber(s.n, locale)}</span>
                  <span className="cal-funnel-bar" aria-hidden="true">
                    <span style={{ width: `${funnel.submissions ? Math.round((s.n / funnel.submissions) * 100) : 0}%` }} />
                  </span>
                  {s.key !== 'submissions' && <span className="cal-muted data">{pct(s.n, s.of, locale)}</span>}
                </li>
              ))}
            </ol>
            <p className="ui-help">
              {t('funnel.other', { url: funnel.routedElsewhere, none: funnel.unrouted })}
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('funnel.route')}</th>
                    <th scope="col">{t('funnel.destination')}</th>
                    <th scope="col" className="num">
                      {t('funnel.submissions')}
                    </th>
                    <th scope="col" className="num">
                      {t('funnel.booked')}
                    </th>
                    <th scope="col" className="num">
                      {t('funnel.rate')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {funnel.byRoute.map((r) => (
                    <tr key={`${r.ruleId ?? 'fallback'}-${r.outcome}-${r.target}`}>
                      <td>{r.ruleId ? (ruleLabels[r.ruleId] ?? t('funnel.deletedRule')) : r.outcome === 'none' ? t('funnel.noRoute') : t('funnel.fallback')}</td>
                      <td className="data cal-wrap">{r.target || (r.outcome === 'message' ? t('funnel.message') : '–')}</td>
                      <td className="num data" data-label={t('funnel.submissions')}>
                        {formatNumber(r.submissions, locale)}
                      </td>
                      <td className="num data" data-label={t('funnel.booked')}>
                        {r.outcome === 'event' ? formatNumber(r.booked, locale) : '–'}
                      </td>
                      <td className="num data" data-label={t('funnel.rate')}>
                        {r.outcome === 'event' ? pct(r.booked, r.submissions, locale) : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
