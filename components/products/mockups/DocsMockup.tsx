import { useTranslations } from 'next-intl';
import ZeroMark from '@/components/zero/ZeroMark';
import { MkCheck } from './MkIcons';

export default function DocsMockup() {
  const t = useTranslations('pages.mockups.docs');

  return (
    <div className="mk mk-docs">
      <aside className="mk-side">
        <div className="mk-brand">
          <ZeroMark size={16} />
          <span>Docs</span>
        </div>
        <nav className="mk-nav" aria-hidden="true">
          <span className="active">{t('navHome')}</span>
          <span>{t('navPages')}</span>
          <span>{t('navShared')}</span>
        </nav>
      </aside>

      <div className="mk-main">
        <div className="mk-doc">
          <h4 className="mk-doc-title">{t('title')}</h4>
          <p className="mk-doc-p">{t('p1')}</p>
          <h5 className="mk-doc-h2">{t('h2')}</h5>
          <p className="mk-doc-p">{t('p2')}</p>
          <div className="mk-doc-list">
            <span>
              <MkCheck done={false} />
              {t('item1')}
            </span>
            <span>
              <MkCheck done />
              {t('item2')}
            </span>
            <span>
              <MkCheck done={false} />
              {t('item3')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
