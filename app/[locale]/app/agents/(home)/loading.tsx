import { getTranslations } from 'next-intl/server';

/** Carga de /app/agents: la cabecera y la tabla como placas de esmalte. */
export default async function AgentsLoading() {
  const t = await getTranslations('agents');
  return (
    <div className="app-page ui-page ag-home" aria-busy="true">
      <span className="sr-only" role="status">
        {t('list.loading')}
      </span>
      <div className="ui-page-header">
        <div className="ui-page-header-text ag-skel-head">
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
