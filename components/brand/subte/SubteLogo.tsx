import { WORDMARK, markColors, type MarkTone } from '@/lib/brand';
import Station from '../Station';

/**
 * Logo del tema subte (html[data-brand="subte"]): el wordmark en minúscula con la "o" de zero como
 * estación (círculo con anillo grueso). Trazado, no texto: se ve igual en
 * cualquier lugar. `tone="ink"` sobre fondos claros, `tone="white"` sobre la
 * banda negra. `variant="symbol"` es la estación sola.
 */
export default function SubteLogo({
  tone = 'ink',
  height = 24,
  variant = 'wordmark',
  title = 'zerosoft',
  className = '',
}: {
  tone?: MarkTone;
  /** Alto en px de la caja de tinta (el ancho sale de la proporción). */
  height?: number;
  variant?: 'wordmark' | 'symbol';
  /** Nombre accesible; vacío lo vuelve decorativo. */
  title?: string;
  className?: string;
}) {
  const { fg, hole } = markColors(tone);
  const a11y = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const };

  if (variant === 'symbol') {
    return <Station size={height} ring={fg} fill={hole} className={`brand-logo ${className}`.trim()} title={title} />;
  }

  const st = WORDMARK.station;
  const w = st.ring;
  return (
    <svg
      className={`brand-logo ${className}`.trim()}
      viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`}
      height={height}
      width={Math.round((height * WORDMARK.width) / WORDMARK.height)}
      focusable="false"
      {...a11y}
    >
      <path d={WORDMARK.letters} fill={fg} />
      <circle
        className="brand-logo-station"
        cx={st.cx}
        cy={st.cy}
        r={st.r - w / 2}
        fill={hole}
        stroke={fg}
        strokeWidth={w}
      />
    </svg>
  );
}
