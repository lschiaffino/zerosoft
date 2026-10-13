import { ZERO_PATH, ZERO_VIEWBOX } from '@/lib/zero-mark';

/**
 * El cero de la marca. Hereda el color del texto (currentColor), así que el
 * mismo componente sirve de logo, de marca por producto (con .card-<key> y
 * color: var(--accent)) y de viñeta.
 */
export default function ZeroMark({
  size = 18,
  className = '',
  title,
}: {
  /** Alto en px (el ancho sale de la proporción del glifo). */
  size?: number;
  className?: string;
  /** Si se pasa, el SVG deja de ser decorativo y se anuncia con este nombre. */
  title?: string;
}) {
  return (
    <svg
      className={`zero-mark ${className}`.trim()}
      viewBox={ZERO_VIEWBOX}
      height={size}
      width={(size * 20) / 24}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <path d={ZERO_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
