'use client';

import ZeroMark from '@/components/zero/ZeroMark';

/**
 * Glifo de acento (estados vacíos, cabeceras de páginas públicas): el cero en
 * un color dado. `height` es el alto en px.
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
  return (
    <span className={`accent-glyph ${className}`.trim()} style={{ color }} aria-hidden="true">
      <ZeroMark size={Math.round(height * 1.15)} />
    </span>
  );
}
