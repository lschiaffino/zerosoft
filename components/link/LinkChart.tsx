import type { DayCount } from '@/lib/track';

interface LinkChartProps {
  data: DayCount[];
  /** Segunda serie (misma longitud que data), dibujada como línea punteada. */
  secondary?: DayCount[];
  height?: number;
}

/** Rounds up to a "nice" ceiling (1/2/5 × 10^n) so grid labels look clean. */
function niceCeil(max: number): number {
  if (max <= 1) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Hand-rolled SVG area chart (no deps): polyline + area fill,
 * horizontal grid lines, date label every 5 days. Server-renderable.
 */
export default function LinkChart({ data, secondary, height = 240 }: LinkChartProps) {
  const W = 760;
  const H = height;
  const pad = { t: 18, r: 14, b: 30, l: 42 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const max = niceCeil(Math.max(...data.map((d) => d.count), ...(secondary ?? []).map((d) => d.count), 0));
  const stepX = data.length > 1 ? iw / (data.length - 1) : 0;
  const pts = data.map(
    (d, i) => [pad.l + i * stepX, pad.t + ih - (d.count / max) * ih] as const,
  );
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const line2 = (secondary ?? [])
    .map((d, i) => `${(pad.l + i * stepX).toFixed(1)},${(pad.t + ih - (d.count / max) * ih).toFixed(1)}`)
    .join(' ');
  const labelEvery = Math.max(5, Math.ceil(data.length / 8));
  const baseline = pad.t + ih;
  const area = `${pad.l},${baseline} ${line} ${(pad.l + iw).toFixed(1)},${baseline}`;

  const gridRows = [0, 1, 2, 3, 4].map((k) => {
    const value = (max * k) / 4;
    const y = pad.t + ih - (value / max) * ih;
    return { value, y };
  });

  return (
    <svg
      className="link-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="clicks chart"
      preserveAspectRatio="none"
    >
      {gridRows.map((g) => (
        <g key={g.value}>
          <line className="chart-grid" x1={pad.l} x2={pad.l + iw} y1={g.y} y2={g.y} />
          <text className="chart-ylabel" x={pad.l - 8} y={g.y + 4} textAnchor="end">
            {g.value}
          </text>
        </g>
      ))}
      {data.length > 0 && (
        <>
          <polygon className="chart-area" points={area} />
          <polyline className="chart-line" points={line} fill="none" />
          {line2 && <polyline className="chart-line-2" points={line2} fill="none" />}
          <circle
            className="chart-dot"
            cx={pts[pts.length - 1][0]}
            cy={pts[pts.length - 1][1]}
            r={3.5}
          />
        </>
      )}
      {data.map((d, i) =>
        (i % labelEvery === 0 && data.length - 1 - i >= labelEvery / 2) || i === data.length - 1 ? (
          <text
            key={d.date}
            className="chart-xlabel"
            x={pad.l + i * stepX}
            y={H - 8}
            textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
          >
            {d.date.slice(5)}
          </text>
        ) : null,
      )}
    </svg>
  );
}
