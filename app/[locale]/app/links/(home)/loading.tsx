import { useTranslations } from 'next-intl';

/** Carga de cualquier pantalla de Link: placas de esmalte con la forma de la página, sin spinner. */
export default function LinksLoading() {
  const t = useTranslations('link.states');
  return (
    <div className="ui-page lk-loading" role="status" aria-label={t('loading')}>
      <div className="ui-page-header">
        <span className="ui-skeleton ui-skeleton-title" />
      </div>
      <span className="ui-skeleton lk-skeleton-bar" />
      <div className="ui-loading-stack">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="ui-skeleton ui-skeleton-row" />
        ))}
      </div>
    </div>
  );
}
