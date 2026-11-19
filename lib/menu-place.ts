/**
 * Dónde va un menú fijo que se abre desde un botón: debajo, con el borde
 * derecho alineado al del botón. Si no entra, se corre para quedar entero
 * dentro de la ventana (hacia la derecha si se sale por la izquierda, arriba
 * del botón si se sale por abajo).
 */
export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const EDGE = 8;
const GAP = 2;

export function menuPlace(btn: Box, width: number, height: number, viewW: number, viewH: number): { top: number; left: number } {
  const maxLeft = Math.max(EDGE, viewW - width - EDGE);
  const left = Math.min(Math.max(btn.right - width, EDGE), maxLeft);
  const below = btn.bottom + GAP;
  const fits = below + height <= viewH - EDGE;
  const top = fits ? below : Math.max(EDGE, btn.top - GAP - height);
  return { top: Math.round(top), left: Math.round(left) };
}
