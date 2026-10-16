import { getTranslations } from 'next-intl/server';

/** Carga de Docs: el árbol y la página como placas de esmalte, sin spinner. */
export default async function DocsLoading() {
  const t = await getTranslations('docs.state');
  return (
    <div className="docs-layout" aria-busy="true" aria-label={t('loading')}>
      <div className="docs-sidebar docs-sidebar-loading">
        <div className="docs-sidebar-head">
          <span className="ui-skeleton ui-skeleton-text" style={{ width: 96 }} />
        </div>
        <div className="docs-sidebar-body ui-loading-stack">
          {[72, 56, 64, 48, 60, 52].map((w, i) => (
            <span key={i} className="ui-skeleton ui-skeleton-text" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
      <div className="docs-main">
        <div className="docs-loading-page ui-loading-stack">
          <span className="ui-skeleton ui-skeleton-title" style={{ width: '55%', height: 40 }} />
          <span className="ui-skeleton ui-skeleton-text" style={{ width: '90%' }} />
          <span className="ui-skeleton ui-skeleton-text" style={{ width: '84%' }} />
          <span className="ui-skeleton ui-skeleton-text" style={{ width: '70%' }} />
          <span className="ui-skeleton ui-skeleton-block" />
        </div>
      </div>
    </div>
  );
}
