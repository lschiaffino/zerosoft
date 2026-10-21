/**
 * Board — coordenadas de la escena ↔ píxeles del lienzo. Excalidraw dibuja un
 * punto (x, y) de la escena en ((x + scrollX) · zoom, (y + scrollY) · zoom)
 * relativo a la esquina del lienzo; los pins de comentarios usan lo mismo.
 */

export interface CanvasView {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export function sceneToView(p: { x: number; y: number }, v: CanvasView): { x: number; y: number } {
  return { x: (p.x + v.scrollX) * v.zoom, y: (p.y + v.scrollY) * v.zoom };
}

export function viewToScene(p: { x: number; y: number }, v: CanvasView): { x: number; y: number } {
  const zoom = v.zoom || 1;
  return { x: p.x / zoom - v.scrollX, y: p.y / zoom - v.scrollY };
}

/** Cuenta regresiva del timer del taller: "4:05" / "1:02:30" (redondea hacia arriba). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
