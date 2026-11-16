import { useTranslations } from 'next-intl';

const DAYS = [
  ['d1', 7.5],
  ['d2', 8],
  ['d3', 6.25],
  ['d4', 8.5],
  ['d5', 4],
] as const;
const ROWS = ['r1', 'r2', 'r3'] as const;

/** Una semana de horas: el total de cada día y las entradas de hoy, una con el cronómetro corriendo. */
export default function TimeMockup() {
  const t = useTranslations('pages.mockups.time');
  const max = Math.max(...DAYS.map(([, h]) => h));

  return (
    <div className="mk mk-chat">
      <aside className="mk-chat-list">
        <div className="mk-chat-list-head">
          <h4>{t('listTitle')}</h4>
        </div>
        {DAYS.map(([d, h], i) => (
          <div className={`mk-chat-row${i === 3 ? ' active' : ''}`} key={d}>
            <span className="mk-chat-row-main">
              <span className="mk-chat-row-top">
                <span className="mk-chat-name">{t(d)}</span>
                <span className="mk-chat-time">{`${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`}</span>
              </span>
              <span style={{ display: 'block', height: 6, marginTop: 6, background: 'var(--line)' }}>
                <span style={{ display: 'block', height: '100%', width: `${(h / max) * 100}%`, background: 'var(--accent)' }} />
              </span>
            </span>
          </div>
        ))}
      </aside>

      <div className="mk-chat-main">
        <div className="mk-chat-conv-head">
          <span className="mk-chat-name">{t('d4')}</span>
          <span className="mk-status is-accent">
            <i />
            {t('running')}
          </span>
        </div>
        <div className="mk-chat-thread">
          {ROWS.map((r) => (
            <div className="mk-msg mk-msg-bot" key={r} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 44px', gap: 8, alignItems: 'center' }}>
              <span>
                <strong style={{ display: 'block' }}>{t(`${r}name`)}</strong>
                <span>{t(`${r}meta`)}</span>
              </span>
              <span style={{ textAlign: 'right', fontFamily: 'var(--font-data)' }}>{t(`${r}time`)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
