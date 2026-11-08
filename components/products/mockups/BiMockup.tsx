import { useTranslations } from 'next-intl';
import ZeroMark from '@/components/zero/ZeroMark';
import { MkPlus } from './MkIcons';

/** Deals ganados por mes (decorativo). */
const MONTHS = [12, 18, 15, 22, 27, 24, 31];
const ROWS = [
  { key: 'r1', value: '48,200' },
  { key: 'r2', value: '31,950' },
  { key: 'r3', value: '12,400' },
] as const;

/**
 * Vista de Analytics: un tablero con un número, barras por mes y una tabla,
 * y la pregunta escrita en palabras arriba. Todo HTML, CSS y SVG.
 */
export default function BiMockup() {
  const t = useTranslations('pages.mockups.analytics');
  const max = Math.max(...MONTHS);
  return (
    <div className="mk mk-link">
      <aside className="mk-side">
        <div className="mk-brand">
          <ZeroMark size={16} />
          <span>Analytics</span>
        </div>
        <nav className="mk-nav" aria-hidden="true">
          <span className="active">{t('navBrowse')}</span>
          <span>{t('navData')}</span>
          <span>{t('navDashboard')}</span>
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
        <p className="mk-mono" style={{ margin: '0 0 12px', fontSize: 12 }}>
          {t('ask')}
        </p>

        <div className="mk-stats">
          <div className="mk-stat">
            <span className="mk-stat-num">92,550</span>
            <span className="mk-stat-label">{t('statRevenue')}</span>
          </div>
          <div className="mk-stat">
            <span className="mk-stat-num">31</span>
            <span className="mk-stat-label">{t('statWon')}</span>
          </div>
        </div>

        <div className="mk-chart">
          <svg viewBox="0 0 560 120" role="img" aria-label={t('chartLabel')}>
            {MONTHS.map((v, i) => (
              <rect key={i} x={20 + i * 76} y={110 - (v / max) * 100} width={48} height={(v / max) * 100} fill="var(--accent, #0d0d0d)" />
            ))}
          </svg>
          <span className="mk-chart-label">{t('chartLabel')}</span>
        </div>

        <table className="mk-table">
          <thead>
            <tr>
              <th>{t('tableTitle')}</th>
              <th style={{ textAlign: 'right' }}>{t('tableValue')}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.key}>
                <td>{t(r.key)}</td>
                <td className="mk-mono" style={{ textAlign: 'right' }}>
                  {r.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
