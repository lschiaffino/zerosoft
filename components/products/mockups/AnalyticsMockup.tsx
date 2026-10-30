import { useTranslations } from 'next-intl';
import ZeroMark from '@/components/zero/ZeroMark';
import { MkPlus } from './MkIcons';

/** Registros por día (decorativo): esta semana y la anterior, punteada. */
const THIS_WEEK = [42, 55, 49, 68, 74, 61, 88];
const LAST_WEEK = [38, 41, 47, 45, 52, 50, 57];
const FUNNEL = [
  { key: 's1', count: '3,240', pct: 100 },
  { key: 's2', count: '1,102', pct: 34 },
  { key: 's3', count: '486', pct: 15 },
] as const;

function points(values: readonly number[]): string {
  return values.map((v, i) => `${(i * 540) / (values.length - 1) + 10},${110 - v}`).join(' ');
}

/**
 * Vista de Analytics: una tendencia comparada con el período anterior y un
 * embudo de tres pasos. Todo HTML, CSS y SVG.
 */
export default function AnalyticsMockup() {
  const t = useTranslations('pages.mockups.analytics');

  return (
    <div className="mk mk-link">
      <aside className="mk-side">
        <div className="mk-brand">
          <ZeroMark size={16} />
          <span>Analytics</span>
        </div>
        <nav className="mk-nav" aria-hidden="true">
          <span>{t('navWeb')}</span>
          <span className="active">{t('navInsights')}</span>
          <span>{t('navPersons')}</span>
          <span>{t('navFlags')}</span>
        </nav>
        <span className="mk-side-foot">zerosoft · v1.0</span>
      </aside>

      <div className="mk-main">
        <div className="mk-head">
          <h4>{t('title')}</h4>
          <span className="mk-btn">
            <MkPlus />
            {t('new')}
          </span>
        </div>

        <div className="mk-stats">
          <div className="mk-stat">
            <span className="mk-stat-num">3,240</span>
            <span className="mk-stat-label">{t('statVisitors')}</span>
          </div>
          <div className="mk-stat">
            <span className="mk-stat-num">9,871</span>
            <span className="mk-stat-label">{t('statViews')}</span>
          </div>
          <div className="mk-stat">
            <span className="mk-stat-num">41%</span>
            <span className="mk-stat-label">{t('statBounce')}</span>
          </div>
        </div>

        <div className="mk-chart">
          <svg viewBox="0 0 560 120" role="img" aria-label={t('chartLabel')}>
            <polyline points={points(LAST_WEEK)} fill="none" stroke="var(--brand-gray-3, #999)" strokeWidth={2} strokeDasharray="5 4" />
            <polyline points={points(THIS_WEEK)} fill="none" stroke="var(--accent, #0d0d0d)" strokeWidth={3} strokeLinejoin="round" />
          </svg>
          <span className="mk-chart-label">{t('chartLabel')}</span>
        </div>

        <table className="mk-table">
          <thead>
            <tr>
              <th>{t('funnelTitle')}</th>
              <th style={{ width: '40%' }} aria-hidden="true" />
              <th style={{ textAlign: 'right' }}>%</th>
            </tr>
          </thead>
          <tbody>
            {FUNNEL.map((s) => (
              <tr key={s.key}>
                <td>{t(s.key)}</td>
                <td>
                  <span className="mk-stage-bar" aria-hidden="true" style={{ marginTop: 0 }}>
                    <i style={{ width: `${s.pct}%` }} />
                  </span>
                </td>
                <td className="mk-mono" style={{ textAlign: 'right' }}>
                  {s.count} · {s.pct}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
