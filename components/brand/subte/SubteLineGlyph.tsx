import { BRAND_WHITE, brandLine } from '@/lib/brand';
import type { ProductKey } from '@/lib/products';
import Station from '../Station';

/**
 * Marca de producto del tema subte: su estación, con el anillo en el color de su
 * línea. `onLine` la dibuja sobre un tramo de la línea (16:8 del diámetro),
 * como aparece en el plano.
 */
export default function SubteLineGlyph({
  product,
  size = 16,
  onLine = false,
  title,
  className = '',
}: {
  product: ProductKey;
  size?: number;
  onLine?: boolean;
  title?: string;
  className?: string;
}) {
  const l = brandLine(product);
  if (!onLine) {
    return <Station size={size} ring={l.line} fill={BRAND_WHITE} title={title} className={`line-glyph ${className}`.trim()} />;
  }
  const a11y = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const };
  // Tramo de línea de 3 diámetros con la estación al medio; la línea mide 0,36 del diámetro.
  return (
    <svg
      className={`line-glyph line-glyph-track ${className}`.trim()}
      viewBox="0 0 300 100"
      width={size * 3}
      height={size}
      focusable="false"
      {...a11y}
    >
      <line x1="18" y1="50" x2="282" y2="50" stroke={l.line} strokeWidth="36" strokeLinecap="round" />
      <circle cx="150" cy="50" r="39" fill={BRAND_WHITE} stroke="#111111" strokeWidth="22" />
    </svg>
  );
}
