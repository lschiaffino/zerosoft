import { useTranslations } from 'next-intl';

const ROWS = ['r1', 'r2', 'r3'] as const;
const COMMENTS = ['c1', 'c2'] as const;

/** Boceto de Rec (todavía en construcción): la biblioteca de videos y uno abierto con comentarios por minuto. */
export default function RecMockup() {
  const t = useTranslations('pages.mockups.rec');

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
            {t('views')}
          </span>
        </div>
        <div className="mk-rec-frame" aria-hidden="true">
          <span className="mk-rec-screen">{t('screen')}</span>
          <span className="mk-rec-cam" />
          <span className="mk-rec-bar">
            <i />
          </span>
        </div>
        <div className="mk-chat-thread">
          {COMMENTS.map((c) => (
            <div className="mk-msg mk-msg-bot" key={c}>
              <span className="mk-msg-tag">{t(`${c}who`)}</span>
              {t(c)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
