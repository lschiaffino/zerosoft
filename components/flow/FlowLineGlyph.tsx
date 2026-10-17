import { BRAND_INK, BRAND_WHITE, STATION_RING, brandLine } from '@/lib/brand';
import type { ProductKey } from '@/lib/products';

const R = 7;
const STEP = 24;
const H = 20;

/**
 * Un flow dibujado como tramo de la línea de Flow: una estación por paso.
 * Los pasos que tocan otra app de zerosoft llevan el anillo del color de esa
 * línea (combinación). Decorativo: el nombre del flow va al lado en texto.
 */
export default function FlowLineGlyph({ stops, className = '' }: { stops: Array<ProductKey | null>; className?: string }) {
  const n = Math.max(stops.length, 1);
  const w = (n - 1) * STEP + R * 2 + 6;
  // Anillo de 0,44 del radio exterior, como la estación de la marca.
  const ring = R * STATION_RING;
  const r = R - ring / 2;
  const y = H / 2;
  const x0 = R + 3;
  return (
    <svg className={`flow-line-glyph ${className}`.trim()} width={w} height={H} viewBox={`0 0 ${w} ${H}`} aria-hidden="true" focusable="false">
      {n > 1 && (
        <line x1={x0} y1={y} x2={x0 + (n - 1) * STEP} y2={y} stroke={brandLine('flow').line} strokeWidth={6} strokeLinecap="round" />
      )}
      {stops.map((line, i) => (
        <circle
          key={i}
          cx={x0 + i * STEP}
          cy={y}
          r={r}
          fill={BRAND_WHITE}
          stroke={line ? brandLine(line).line : BRAND_INK}
          strokeWidth={ring}
        />
      ))}
    </svg>
  );
}
