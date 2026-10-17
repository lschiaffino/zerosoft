'use client';

import ZeroMark from '@/components/zero/ZeroMark';
import { useBrand } from './BrandProvider';

/**
 * Glifo de acento (estados vacíos, cabeceras de páginas públicas) en un color
 * dado: en default, el cero; en subte, un tramo de línea con su estación.
 * `height` es el alto en px.
 */
export default function AccentGlyph({
  color,
  height = 24,
  className = '',
}: {
  /** Color CSS (p. ej. var(--accent) o var(--c-link)). */
  color: string;
  height?: number;
  className?: string;
}) {
  const brand = useBrand();
  if (brand === 'subte') {
    return (
      <svg className={className} viewBox="0 0 300 100" width={height * 3} height={height} aria-hidden="true" focusable="false">
        <line x1="18" y1="50" x2="282" y2="50" stroke={color} strokeWidth="36" strokeLinecap="round" />
        <circle cx="150" cy="50" r="39" fill="#ffffff" stroke="#111111" strokeWidth="22" />
      </svg>
    );
  }
  return (
    <span className={`accent-glyph ${className}`.trim()} style={{ color }} aria-hidden="true">
      <ZeroMark size={Math.round(height * 1.15)} />
    </span>
  );
}
