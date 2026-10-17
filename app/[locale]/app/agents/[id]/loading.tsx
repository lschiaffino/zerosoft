import { getTranslations } from 'next-intl/server';

/** Carga del editor: cabecera, pestañas y el primer bloque. */
export default async function AgentEditorLoading() {
  const t = await getTranslations('agents');
  return (
    <div className="app-page ui-page ag-editor" aria-busy="true">
      <span className="sr-only" role="status">
        {t('editor.loading')}
      </span>
      <div className="ui-page-header">
        <div className="ui-page-header-text ag-skel-head">
          <span className="ui-skeleton ui-skeleton-text" />
          <span className="ui-skeleton ui-skeleton-title" />
        </div>
      </div>
      <span className="ui-skeleton ui-skeleton-row" />
      <div className="ag-panel ag-panel-narrow ui-loading-stack">
        <span className="ui-skeleton ui-skeleton-text" />
        <span className="ui-skeleton ui-skeleton-block" />
        <span className="ui-skeleton ui-skeleton-block" />
      </div>
    </div>
  );
}
