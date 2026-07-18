import type { WonLostMonth } from '@/lib/crm';

interface WonLostChartProps {
  data: WonLostMonth[];
  wonLabel: string;
  lostLabel: string;
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
 * Hand-rolled SVG grouped bar chart (no deps): won = filled bars,
 * lost = outlined bars, one group per month. Server-renderable.
 */
export default function WonLostChart({ data, wonLabel, lostLabel, height = 240 }: WonLostChartProps) {
  const W = 760;
  const H = height;
  const pad = { t: 18, r: 14, b: 30, l: 42 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const baseline = pad.t + ih;

  const max = niceCeil(Math.max(...data.map((d) => Math.max(d.won, d.lost)), 0));
  const groupW = data.length ? iw / data.length : 0;
  const barW = Math.max(Math.min(groupW / 2 - 10, 36), 6);

  const gridRows = [0, 1, 2, 3, 4].map((k) => {
    const value = (max * k) / 4;
    const y = pad.t + ih - (value / max) * ih;
    return { value, y };
  });

  return (
    <div className="wonlost">
      <svg
        className="link-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="won/lost chart"
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
        {data.map((d, i) => {
          const cx = pad.l + i * groupW + groupW / 2;
          const wonH = (d.won / max) * ih;
          const lostH = (d.lost / max) * ih;
          return (
            <g key={d.month}>
              {d.won > 0 && (
                <rect
                  className="chart-bar"
                  x={cx - barW - 4}
                  y={baseline - wonH}
                  width={barW}
                  height={wonH}
                  rx={2}
                />
              )}
              {d.lost > 0 && (
                <rect
                  className="chart-bar-lost"
                  x={cx + 4}
                  y={baseline - lostH}
                  width={barW}
                  height={lostH}
                  rx={2}
                />
              )}
              <text className="chart-xlabel" x={cx} y={H - 8} textAnchor="middle">
                {d.month.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="chart-legend mono">
        <span className="legend-item">
          <span className="legend-swatch" aria-hidden /> {wonLabel}
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-lost" aria-hidden /> {lostLabel}
        </span>
      </p>
    </div>
  );
}
