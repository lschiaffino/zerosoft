/** "1" → "01". El único formato de numeración del sitio. */
export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Numeración tabular (01, 02…): el único recurso de numeración del sitio.
 * `total` agrega "/ 11" en tono más bajo.
 */
export default function ZeroCounter({
  n,
  total,
  className = '',
}: {
  n: number;
  total?: number;
  className?: string;
}) {
  return (
    <span className={`zero-counter ${className}`.trim()}>
      {pad2(n)}
      {total !== undefined && <span className="zero-counter-total"> / {pad2(total)}</span>}
    </span>
  );
}
