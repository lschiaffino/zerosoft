'use client';

/**
 * Reunión nueva que empieza a escuchar sola (como Granola). Quien la crea
 * desde un clic deja una marca en sessionStorage con el id; la reunión la
 * consume una sola vez. Un link (aunque sea a una reunión propia) nunca
 * prende el micrófono: no deja marca.
 */
const KEY = 'zs-voice-autostart';
const MAX_AGE_MS = 60_000;

export function markAutostart(id: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ id, at: Date.now() }));
  } catch {
    /* sin storage: no empieza sola */
  }
}

export function takeAutostart(id: string): boolean {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return false;
    const v = JSON.parse(raw) as { id?: string; at?: number };
    if (v.id !== id) return false;
    sessionStorage.removeItem(KEY);
    return typeof v.at === 'number' && Date.now() - v.at < MAX_AGE_MS;
  } catch {
    return false;
  }
}

/**
 * ¿Se llegó a esta URL navegando dentro de la app (⌘K, sidebar, aviso)? Si el
 * documento se cargó directo en ella (un link de afuera, la barra de
 * direcciones), no: la carga del documento tiene la misma URL que la actual.
 */
export function arrivedInApp(): boolean {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (!nav?.name) return false;
    const loaded = new URL(nav.name);
    return loaded.pathname + loaded.search !== window.location.pathname + window.location.search;
  } catch {
    return false;
  }
}
