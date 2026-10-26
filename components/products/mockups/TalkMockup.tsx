import { useTranslations } from 'next-intl';
import { MkArrow } from './MkIcons';

const CHANNELS = ['ch1', 'ch2', 'ch3'] as const;
const DMS = ['dm1', 'dm2'] as const;

/** Boceto de Talk (todavía en construcción): canales y mensajes directos, un canal abierto con un hilo. */
export default function TalkMockup() {
  const t = useTranslations('pages.mockups.talk');

  return (
    <div className="mk mk-chat">
      <aside className="mk-chat-list">
        <div className="mk-chat-list-head">
          <h4>{t('channelsTitle')}</h4>
        </div>
        {CHANNELS.map((c, i) => (
          <div className={`mk-chat-row${i === 0 ? ' active' : ''}`} key={c}>
            <span className="mk-chat-name"># {t(c)}</span>
          </div>
        ))}
        <div className="mk-chat-list-head mk-talk-dms">
          <h4>{t('dmsTitle')}</h4>
        </div>
        {DMS.map((d) => (
          <div className="mk-chat-row" key={d}>
            <span className="mk-ava" aria-hidden="true">
              {t(d).charAt(0)}
            </span>
            <span className="mk-chat-name">{t(d)}</span>
          </div>
        ))}
      </aside>

      <div className="mk-chat-main">
        <div className="mk-chat-conv-head">
          <span className="mk-chat-name"># {t('ch1')}</span>
        </div>
        <div className="mk-chat-thread">
          <div className="mk-msg mk-msg-them">
            <span className="mk-msg-tag">{t('m1who')}</span>
            {t('m1')}
          </div>
          <div className="mk-msg mk-msg-bot">
            <span className="mk-msg-tag">{t('threadTag')}</span>
            {t('m2')}
          </div>
          <div className="mk-msg mk-msg-us">{t('m3')}</div>
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
