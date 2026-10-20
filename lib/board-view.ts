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
