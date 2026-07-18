import type { BreakdownItem } from '@/lib/track';

interface BreakdownBarsProps {
  items: BreakdownItem[];
  emptyLabel: string;
  /** Maps raw names (e.g. "direct", "other") to translated labels. */
  labelFor?: (name: string) => string;
}

/** Proportional horizontal bars for referrer/country/device/browser/os breakdowns. */
export default function BreakdownBars({ items, emptyLabel, labelFor }: BreakdownBarsProps) {
  if (items.length === 0) {
    return <p className="muted breakdown-empty">{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="breakdown">
      {items.map((item) => (
        <div className="breakdown-row" key={item.name}>
          <span className="breakdown-name mono" title={item.name}>
            {labelFor ? labelFor(item.name) : item.name}
          </span>
          <span className="breakdown-track">
            <span
              className="breakdown-bar"
              style={{ width: `${Math.max((item.count / max) * 100, 2)}%` }}
            />
          </span>
          <span className="breakdown-count mono">{item.count}</span>
        </div>
      ))}
    </div>
  );
}
