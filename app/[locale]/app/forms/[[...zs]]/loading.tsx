import { getTranslations } from 'next-intl/server';

/** Carga de /app/forms: la cabecera y las filas como placas. */
export default async function FormsLoading() {
  const t = await getTranslations('common.appSoon');
  return (
    <div className="app-page ui-page" aria-busy="true">
      <span className="sr-only" role="status">
        {t('loading', { app: 'Forms' })}
      </span>
      <div className="ui-page-header">
        <div className="ui-page-header-text">
          <span className="ui-skeleton ui-skeleton-title" />
          <span className="ui-skeleton ui-skeleton-text" />
        </div>
      </div>
      <div className="ui-loading-stack">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="ui-skeleton ui-skeleton-row" />
        ))}
      </div>
    </div>
  );
}
