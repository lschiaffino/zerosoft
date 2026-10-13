import { useTranslations } from 'next-intl';

/** Bar heights for the fake 14-day click chart (decorative). */
const BARS = [34, 48, 42, 60, 55, 72, 64, 80, 70, 92, 84, 98, 88, 104];

/**
 * High-fidelity fake of the Link dashboard: sidebar, stat cards,
 * a clicks chart and the links table. All HTML/CSS/SVG, no images.
 */
export default function LinkMockup() {
  const t = useTranslations('pages.mockups.link');
  const rows = ['r1', 'r2', 'r3', 'r4'] as const;

  return (
    <div className="mk mk-link">
      <aside className="mk-side">
        <div className="mk-brand">
          <span className="mk-zero">0</span>
          <span>Link</span>
        </div>
        <nav className="mk-nav" aria-hidden="true">
          <span className="active">{t('navLinks')}</span>
          <span>{t('navAnalytics')}</span>
          <span>{t('navQr')}</span>
          <span>{t('navSettings')}</span>
        </nav>
        <span className="mk-side-foot">zerosoft — v1.0</span>
      </aside>

      <div className="mk-main">
        <div className="mk-head">
          <h4>{t('title')}</h4>
          <span className="mk-btn">{t('new')}</span>
        </div>

        <div className="mk-stats">
          <div className="mk-stat">
            <span className="mk-stat-num">12,480</span>
            <span className="mk-stat-label">{t('statClicks')}</span>
          </div>
          <div className="mk-stat">
            <span className="mk-stat-num">48</span>
            <span className="mk-stat-label">{t('statLinks')}</span>
          </div>
          <div className="mk-stat">
            <span className="mk-stat-num">zs.ai/launch</span>
            <span className="mk-stat-label">{t('statTop')}</span>
          </div>
        </div>

        <div className="mk-chart">
          <svg viewBox="0 0 560 110" role="img" aria-label={t('chartLabel')}>
            {BARS.map((h, i) => (
              <rect
                key={i}
                x={i * 40 + 6}
                y={110 - h}
                width={28}
                height={h}
                rx={2}
                style={{ fill: 'var(--accent, #0d0d0d)' }}
                opacity={0.55 + (0.45 * h) / 104}
              />
            ))}
          </svg>
          <span className="mk-chart-label">{t('chartLabel')}</span>
        </div>

        <table className="mk-table">
          <thead>
            <tr>
              <th>{t('thShort')}</th>
              <th>{t('thDest')}</th>
              <th style={{ textAlign: 'right' }}>{t('thClicks')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <td className="mk-mono">{t(`${r}short`)}</td>
                <td
                  className="muted"
                  style={{
                    maxWidth: 260,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t(`${r}dest`)}
                </td>
                <td className="mk-mono" style={{ textAlign: 'right' }}>
                  {t(`${r}clicks`)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
