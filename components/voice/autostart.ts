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
 * ¿La persona ya interactuó con esta página? Abrir /app/voice?new=1 desde un
 * link externo no cuenta; llegar con ⌘K o el sidebar (navegación dentro de
 * la app) sí. Sin la API (navegadores viejos) no se asume nada.
 */
export function userActivated(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return !!ua?.hasBeenActive;
}
