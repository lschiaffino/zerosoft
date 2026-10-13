import { useTranslations } from 'next-intl';

const STEPS = ['s1', 's2', 's3', 's4'] as const;
const ROWS = ['r1', 'r2', 'r3', 'r4'] as const;

/** Vista de Robots: los pasos del robot y la tabla que extrajo en la última corrida. */
export default function RobotsMockup() {
  const t = useTranslations('pages.mockups.robots');

  return (
    <div className="mk mk-robots">
      <aside className="mk-robots-steps">
        <p className="mk-agents-name">{t('name')}</p>
        <p className="mk-robots-when">{t('schedule')}</p>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s}>
              <span className="mk-mono">{String(i + 1).padStart(2, '0')}</span>
              <span>
                <strong>{t(`${s}k`)}</strong> {t(s)}
              </span>
            </li>
          ))}
        </ol>
      </aside>

      <div className="mk-main">
        <div className="mk-head">
          <h4>{t('resultTitle')}</h4>
          <span className="mk-status is-ok">
            <i />
            {t('resultStatus')}
          </span>
        </div>
        <table className="mk-table">
          <thead>
            <tr>
              <th>{t('thItem')}</th>
              <th style={{ textAlign: 'right' }}>{t('thPrice')}</th>
              <th style={{ textAlign: 'right' }}>{t('thChange')}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r}>
                <td>{t(`${r}item`)}</td>
                <td className="mk-mono" style={{ textAlign: 'right' }}>
                  {t(`${r}price`)}
                </td>
                <td className="mk-mono" style={{ textAlign: 'right' }}>
                  {t(`${r}change`)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mk-robots-json mk-mono">{t('json')}</p>
      </div>
    </div>
  );
}
