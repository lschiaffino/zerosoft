/**
 * El zoom de la conversación (Lines e Inbox): pellizcar en el trackpad agranda
 * solo los mensajes, no la app entera.
 *
 * Cómo llega el pellizco según dónde corre la app:
 * - Chrome, Edge, Firefox y WebView2 (la app de escritorio en Windows): un
 *   evento `wheel` con ctrlKey y deltas chicos (Chrome manda
 *   deltaY = -100 · ln(escala)).
 * - Safari y WKWebView (la app de escritorio en Mac): gesturestart,
 *   gesturechange y gestureend, con `scale` relativo al inicio del gesto.
 *
 * Sin dependencias del DOM: lo usan el hook y los tests.
 */

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2;
export const ZOOM_STORAGE_KEY = 'zs:conversation-zoom';
/** Los paneles de mensajes: el de WhatsApp (Lines e Inbox) y el de correo de Inbox. */
export const ZOOM_PANE = '.wa-messages, .ib-messages';

export function clampZoom(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return ZOOM_MIN;
  // Dos decimales: lo guardado y lo aplicado son el mismo número, y cerca de 100% vuelve a 100% justo.
  const r = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) * 100) / 100;
  return r < 1.02 ? ZOOM_MIN : r;
}

/**
 * ¿Es un pellizco del trackpad? Un pellizco manda muchos eventos con deltas
 * chicos. Ctrl + la rueda de un mouse manda saltos de 100 o más: ese es el
 * zoom del navegador y se deja pasar.
 */
export function isPinchWheel(e: { ctrlKey: boolean; deltaMode: number; deltaY: number }): boolean {
  return e.ctrlKey && e.deltaMode === 0 && e.deltaY !== 0 && Math.abs(e.deltaY) < 50;
}

/** El zoom después de un evento de rueda del pellizco (la misma curva que usa el navegador). */
export function zoomAfterWheel(zoom: number, deltaY: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * Math.exp(-deltaY / 100)));
}

/** El zoom durante un gesto de Safari: el del inicio por la escala del gesto. */
export function zoomAfterGesture(start: number, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return start;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, start * scale));
}

export function readStoredZoom(raw: string | null): number {
  return raw === null ? ZOOM_MIN : clampZoom(raw);
}
