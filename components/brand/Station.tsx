import { BRAND_INK, BRAND_WHITE, STATION_RING } from '@/lib/brand';

/**
 * La estación (el cero de la marca): círculo blanco con un anillo grueso de
 * 0,44 del radio. `interchange` dibuja la combinación: dos anillos unidos por
 * una barra, como en los planos de subte.
 */
export default function Station({
  size = 24,
  ring = BRAND_INK,
  fill = BRAND_WHITE,
  interchange = false,
  title,
  className = '',
}: {
  /** Alto en px (diámetro exterior). */
  size?: number;
  ring?: string;
  fill?: string;
  interchange?: boolean;
  /** Si se pasa, el SVG se anuncia con este nombre; si no, es decorativo. */
  title?: string;
  className?: string;
}) {
  const a11y = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const };
  const w = 50 * STATION_RING;
  const r = 50 - w / 2;
  if (!interchange) {
    return (
      <svg className={`station ${className}`.trim()} viewBox="0 0 100 100" width={size} height={size} focusable="false" {...a11y}>
        <circle cx="50" cy="50" r={r} fill={fill} stroke={ring} strokeWidth={w} />
      </svg>
    );
  }
  // Dos estaciones a 1,6 radios de distancia, unidas por una barra del grosor del anillo.
  const gap = 80;
  return (
    <svg
      className={`station station-interchange ${className}`.trim()}
      viewBox={`0 0 ${100 + gap} 100`}
      width={(size * (100 + gap)) / 100}
      height={size}
      focusable="false"
      {...a11y}
    >
      <rect x="50" y={50 - w / 2} width={gap} height={w} fill={ring} />
      <circle cx="50" cy="50" r={r} fill={fill} stroke={ring} strokeWidth={w} />
      <circle cx={50 + gap} cy="50" r={r} fill={fill} stroke={ring} strokeWidth={w} />
    </svg>
  );
}
