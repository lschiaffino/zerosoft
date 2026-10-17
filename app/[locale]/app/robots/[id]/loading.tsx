import { getTranslations } from 'next-intl/server';

/** Carga del editor: cabecera, pestañas y la línea de pasos. */
export default async function RobotLoading() {
  const t = await getTranslations('robots');
  return (
    <div className="app-page ui-page" aria-busy="true">
      <span className="sr-only" role="status">
        {t('loading')}
      </span>
      <div className="ui-loading-stack">
        <span className="ui-skeleton ui-skeleton-text" />
        <span className="ui-skeleton ui-skeleton-title" />
      </div>
      <span className="ui-skeleton ui-skeleton-row" />
      <div className="ui-loading-stack">
        <span className="ui-skeleton ui-skeleton-block" />
        <span className="ui-skeleton ui-skeleton-block" />
      </div>
    </div>
  );
}
