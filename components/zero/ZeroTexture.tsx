import { zeroEdge, zeroRule } from '@/lib/zero-texture';

/** Más columnas de las que entran en cualquier pantalla: el resto se recorta. */
const COLS = 320;

/**
 * Un filete hecho de ceros (·°o0Ø0o°·), en el color del texto y tenue.
 * Decorativo: reemplaza a la línea de 1px donde el corte merece un momento.
 */
export function ZeroRule({ className = '' }: { className?: string }) {
  return (
    <pre className={`zero-rule ${className}`.trim()} aria-hidden="true">
      {zeroRule(COLS)}
    </pre>
  );
}

/**
 * El paso de la página a una banda de tinta, tramado con ceros: arriba vacío,
 * abajo lleno. Va justo antes de la banda (.lp-end) y toma su color.
 */
export function ZeroEdge({ rows = 6, className = '' }: { rows?: number; className?: string }) {
  return (
    <pre className={`zero-edge ${className}`.trim()} aria-hidden="true">
      {zeroEdge(COLS, rows)}
    </pre>
  );
}
