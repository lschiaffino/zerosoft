import { getTranslations } from 'next-intl/server';

/** Carga de Analytics: la forma de la página en placas. */
export default async function AnalyticsLoading() {
  const t = await getTranslations('analytics.common');
  return (
    <div className="app-page ui-page" aria-busy="true">
      <span className="sr-only" role="status">
        {t('loading')}
      </span>
      <div className="ui-loading-stack">
        <span className="ui-skeleton ui-skeleton-title" />
        <span className="ui-skeleton ui-skeleton-text" />
      </div>
      <span className="ui-skeleton ui-skeleton-block" />
      <div className="ui-loading-stack">
        <span className="ui-skeleton ui-skeleton-row" />
        <span className="ui-skeleton ui-skeleton-row" />
        <span className="ui-skeleton ui-skeleton-row" />
      </div>
    </div>
  );
}
