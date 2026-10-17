/** Carga de cualquier pantalla de Cal: la forma de una página (cabecera y filas), sin spinner. */
export default function CalendarLoading() {
  return (
    <div className="ui-page" aria-busy="true">
      <div className="ui-page-header">
        <div className="ui-page-header-text cal-loading-head">
          <span className="ui-skeleton ui-skeleton-title" />
          <span className="ui-skeleton ui-skeleton-text" />
        </div>
      </div>
      <div className="ui-loading-stack">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="ui-skeleton ui-skeleton-row" />
        ))}
      </div>
    </div>
  );
}
