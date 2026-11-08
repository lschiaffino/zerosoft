import { useTranslations } from 'next-intl';

const ROWS = ['r1', 'r2', 'r3', 'r4'] as const;

/** La bandeja personal: chats de WhatsApp y correos en una lista, la conversación abierta y el campo con IA. */
export default function InboxMockup() {
  const t = useTranslations('pages.mockups.inbox');

  return (
    <div className="mk mk-chat">
      <aside className="mk-chat-list">
        <div className="mk-chat-list-head">
          <h4>{t('listTitle')}</h4>
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
            {t('status')}
          </span>
        </div>
        <div className="mk-chat-thread">
          <div className="mk-msg mk-msg-them">{t('m1')}</div>
          <div className="mk-msg mk-msg-us">{t('m2')}</div>
          <div className="mk-msg mk-msg-them">{t('m3')}</div>
          <div className="mk-msg mk-msg-bot" style={{ alignSelf: 'flex-end', borderStyle: 'dashed' }}>
            <span className="mk-msg-tag">{t('draftTag')}</span>
            {t('draft')}
          </div>
        </div>
      </div>
    </div>
  );
}
