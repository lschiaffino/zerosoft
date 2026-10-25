import { useTranslations } from 'next-intl';

const ROWS = ['r1', 'r2', 'r3'] as const;

/** Boceto de Voice (todavía en construcción): la lista de reuniones y una nota con resumen y tareas. */
export default function VoiceMockup() {
  const t = useTranslations('pages.mockups.voice');

  return (
    <div className="mk mk-chat">
      <aside className="mk-chat-list">
        <div className="mk-chat-list-head">
          <h4>{t('listTitle')}</h4>
          <span className="mk-sketch">{t('sketch')}</span>
        </div>
        {ROWS.map((r, i) => (
          <div className={`mk-chat-row${i === 0 ? ' active' : ''}`} key={r}>
            <span className="mk-chat-row-main">
              <span className="mk-chat-row-top">
                <span className="mk-chat-name">{t(`${r}name`)}</span>
                <span className="mk-chat-time">{t(`${r}time`)}</span>
              </span>
              <span className="mk-chat-snippet">{t(`${r}meta`)}</span>
            </span>
          </div>
        ))}
      </aside>

      <div className="mk-chat-main">
        <div className="mk-chat-conv-head">
          <span className="mk-chat-name">{t('r1name')}</span>
          <span className="mk-status is-accent">
            <i />
            {t('speakers')}
          </span>
        </div>
        <div className="mk-note">
          <h5>{t('summaryTitle')}</h5>
          <p>{t('summary')}</p>
          <h5>{t('decisionsTitle')}</h5>
          <ul>
            <li>{t('d1')}</li>
            <li>{t('d2')}</li>
          </ul>
          <h5>{t('tasksTitle')}</h5>
          <ul>
            <li>{t('t1')}</li>
            <li>{t('t2')}</li>
          </ul>
        </div>
        <div className="mk-chat-reply">
          <span className="mk-chat-reply-hint">{t('askHint')}</span>
        </div>
      </div>
    </div>
  );
}
