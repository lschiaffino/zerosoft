import { useTranslations } from 'next-intl';
import ZeroMark from '@/components/zero/ZeroMark';

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
          <div className="mk-doc-line" style={{ width: '92%' }} />
          <div className="mk-doc-line" style={{ width: '88%' }} />
          <div className="mk-doc-line" style={{ width: '96%' }} />
          <div className="mk-doc-line" style={{ width: '60%' }} />
          <div className="mk-doc-h" />
          <div className="mk-doc-line" style={{ width: '80%' }} />
          <div className="mk-doc-line" style={{ width: '76%' }} />
          <div className="mk-doc-list">
            <span>☐ {t('item1')}</span>
            <span>☑ {t('item2')}</span>
            <span>☐ {t('item3')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
