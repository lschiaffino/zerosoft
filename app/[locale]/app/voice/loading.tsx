import { getTranslations } from 'next-intl/server';

/** Carga de Voice: la forma de la página en placas. */
export default async function VoiceLoading() {
  const t = await getTranslations('voice');
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
