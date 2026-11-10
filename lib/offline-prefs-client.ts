import { OFFLINE_PREFS_KEY, parseOfflinePrefs, type OfflinePrefs } from './offline-prefs';

/** Los ajustes sin conexión de este navegador (default si no hay nada o no hay storage). Cliente. */
export function readOfflinePrefs(): OfflinePrefs {
  try {
    const raw = window.localStorage.getItem(OFFLINE_PREFS_KEY);
    return parseOfflinePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return parseOfflinePrefs(null);
  }
}

export function writeOfflinePrefs(prefs: OfflinePrefs): void {
  try {
    window.localStorage.setItem(OFFLINE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* sin storage: vale para esta visita (el worker igual los guarda) */
  }
}
