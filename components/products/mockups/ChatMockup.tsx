import { useTranslations } from 'next-intl';
import { MkArrow } from './MkIcons';

const ROWS = ['r1', 'r2', 'r3'] as const;

/** High-fidelity fake of Chat: shared inbox list plus the active thread. */
export default function ChatMockup() {
  const t = useTranslations('pages.mockups.chat');

  return (
    <div className="mk mk-chat">
      <aside className="mk-chat-list">
        <div className="mk-chat-list-head">
          <h4>{t('listTitle')}</h4>
          <span className="mk-chat-count mk-mono">3</span>
        </div>
        {ROWS.map((r, i) => (
          <div className={`mk-chat-row${i === 0 ? ' active' : ''}`} key={r}>
            <span className="mk-ava" aria-hidden="true">
              {t(`${r}name`).charAt(0)}
            </span>
            <span className="mk-chat-row-main">
              <span className="mk-chat-row-top">
                <span className="mk-chat-name">{t(`${r}name`)}</span>
                <span className="mk-chat-time">{t(`${r}time`)}</span>
              </span>
              <span className="mk-chat-snippet">{t(`${r}msg`)}</span>
            </span>
          </div>
        ))}
      </aside>

      <div className="mk-chat-main">
        <div className="mk-chat-conv-head">
          <span className="mk-chat-name">{t('r1name')}</span>
          <span className="mk-status is-ok">
            <i />
            {t('statusOpen')}
          </span>
        </div>

        <div className="mk-chat-thread">
          <div className="mk-msg mk-msg-them">{t('m1')}</div>
          <div className="mk-msg mk-msg-bot">
            <span className="mk-msg-tag">{t('botTag')}</span>
            {t('m2')}
          </div>
          <div className="mk-msg mk-msg-them">{t('m3')}</div>
          <div className="mk-msg mk-msg-us">{t('m4')}</div>
        </div>

        <div className="mk-chat-reply">
          <span className="mk-chat-reply-hint">{t('replyHint')}</span>
          <span className="mk-chat-send" aria-hidden="true">
            <MkArrow />
          </span>
        </div>
      </div>
    </div>
  );
}
