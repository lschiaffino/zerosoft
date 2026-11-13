import type { CSSProperties } from 'react';

/** Lo que se ve mientras carga una página de analítica (loading.tsx): el encabezado, las tarjetas y un gráfico como placas. */
export default function AnalyticsSkeleton({ label }: { label: string }) {
  return (
    <div className="ui-page la la-skeleton" aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      <span className="la-skel la-skel-head" />
      <div className="la-kpis" style={{ '--cols': 4 } as CSSProperties}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="la-kpi">
            <span className="la-skel la-skel-line" />
            <span className="la-skel la-skel-num" />
          </div>
        ))}
      </div>
      <div className="la-panel">
        <span className="la-skel la-skel-chart" />
      </div>
    </div>
  );
}
