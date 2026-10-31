import { getTranslations } from 'next-intl/server';

/** Carga de /app/robots: la forma de la página en placas de esmalte. */
export default async function RobotsLoading() {
  const t = await getTranslations('robots');
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
