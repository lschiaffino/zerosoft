/**
 * Color de una línea (Lines): se elige en Ajustes › Números y se ve como un
 * punto en la fila del chat, en el selector de línea y en "Responder desde".
 * Paleta corta sobre los tokens del tema (styles/groups.css, .gr-line-dot),
 * que se ven bien en claro y en oscuro. '' = sin color (no se muestra punto).
 */
export const LINE_COLORS = ['blue', 'green', 'orange', 'red', 'purple', 'teal', 'yellow', 'pink'] as const;

export type LineColor = (typeof LINE_COLORS)[number];

/** El color guardado si es uno de la paleta; si no, '' (sin color). */
export function lineColor(v: unknown): LineColor | '' {
  return typeof v === 'string' && (LINE_COLORS as readonly string[]).includes(v) ? (v as LineColor) : '';
}
