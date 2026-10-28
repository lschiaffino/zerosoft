'use client';

import { useFormatter } from 'next-intl';

export interface ViewsDay {
  day: string;
  views: number;
  visitors: number;
}

/** Barras de vistas por día (sin librería): una barra por día, el valor en el title y en la tabla oculta. */
export default function DocsViewsChart({ series, label }: { series: ViewsDay[]; label: string }) {
  const format = useFormatter();
  const max = Math.max(1, ...series.map((d) => d.views));
  const fmt = (day: string) => format.dateTime(new Date(`${day}T12:00:00Z`), { day: 'numeric', month: 'short' });
  return (
    <figure className="docs-views-chart" aria-label={label}>
      <div className="docs-views-bars" aria-hidden="true">
        {series.map((d) => (
          <span key={d.day} className="docs-views-bar" title={`${fmt(d.day)}: ${d.views}`}>
            <span style={{ height: `${Math.round((d.views / max) * 100)}%` }} data-zero={d.views === 0 || undefined} />
          </span>
        ))}
      </div>
      {series.length > 0 && (
        <figcaption className="docs-views-axis" aria-hidden="true">
          <span>{fmt(series[0].day)}</span>
          <span>{fmt(series[series.length - 1].day)}</span>
        </figcaption>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {series.map((d) => (
            <tr key={d.day}>
              <th scope="row">{fmt(d.day)}</th>
              <td>{d.views}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
