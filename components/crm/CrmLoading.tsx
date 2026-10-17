/**
 * Esqueletos de carga del CRM (loading.tsx de cada ruta): la forma de la
 * vista que viene, en placas de esmalte. Sin spinner en medio del contenido.
 */
export default function CrmLoading({ variant }: { variant: 'list' | 'record' }) {
  return (
    <div className="ui-page crm-loading" aria-busy="true" aria-live="polite">
      <div className="crm-loading-head">
        <span className="ui-skeleton ui-skeleton-title" />
        <span className="ui-skeleton ui-skeleton-text" />
      </div>
      {variant === 'record' ? (
        <>
          <span className="ui-skeleton crm-loading-tabs" />
          <div className="crm-loading-record">
            <div className="ui-loading-stack">
              <span className="ui-skeleton ui-skeleton-block" />
              <span className="ui-skeleton ui-skeleton-row" />
              <span className="ui-skeleton ui-skeleton-row" />
              <span className="ui-skeleton ui-skeleton-row" />
            </div>
            <div className="ui-loading-stack">
              <span className="ui-skeleton ui-skeleton-text" />
              <span className="ui-skeleton ui-skeleton-text" />
              <span className="ui-skeleton ui-skeleton-text" />
            </div>
          </div>
        </>
      ) : (
        <div className="ui-loading-stack">
          <span className="ui-skeleton crm-loading-toolbar" />
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      )}
    </div>
  );
}
