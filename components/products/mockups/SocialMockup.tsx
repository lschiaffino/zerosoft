import { useTranslations } from 'next-intl';

const DAYS = [
  ['mon', 'p1', 'facebook'],
  ['tue', 'p2', 'linkedin'],
  ['wed', 'p3', 'instagram'],
] as const;

/** Boceto de Social: la semana en el calendario y el compositor con su contador por red. */
export default function SocialMockup() {
  const t = useTranslations('pages.mockups.social');
  return (
    <div className="mk mk-chat">
      <aside className="mk-chat-list">
        <div className="mk-chat-list-head">
          <h4>{t('title')}</h4>
        </div>
        {DAYS.map(([day, post], i) => (
          <div className={`mk-chat-row${i === 0 ? ' active' : ''}`} key={day}>
            <span className="mk-ava" aria-hidden="true">
              {t(day).charAt(0)}
            </span>
            <span className="mk-chat-name">
              {t(day)} · {t(post)}
            </span>
          </div>
        ))}
      </aside>
      <div className="mk-chat-main">
        <div className="mk-chat-conv-head">
          <span className="mk-chat-name">{t('composer')}</span>
        </div>
        <div className="mk-chat-thread">
          <div className="mk-msg mk-msg-us">{t('text')}</div>
          <div className="mk-msg mk-msg-bot">
            <span className="mk-msg-tag">{t('counter')}</span>
            {t('approve')}
          </div>
        </div>
      </div>
    </div>
  );
}
