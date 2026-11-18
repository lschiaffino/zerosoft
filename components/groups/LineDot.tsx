'use client';

/**
 * Punto del color de una línea (styles/groups.css, .gr-line-dot). Sin color no
 * se dibuja nada. `label` lo nombra para lectores de pantalla; sin label es
 * decorativo (el nombre de la línea ya está al lado).
 */
export default function LineDot({ color, label }: { color?: string; label?: string }) {
  if (!color) return null;
  return label ? (
    <span className="gr-line-dot" data-line-color={color} role="img" aria-label={label} title={label} data-testid="line-dot" />
  ) : (
    <span className="gr-line-dot" data-line-color={color} aria-hidden="true" data-testid="line-dot" />
  );
}
