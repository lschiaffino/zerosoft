/**
 * Qué apps andan sin conexión (lectura de lo ya abierto y cambios que se
 * mandan al volver la red) y cuáles necesitan conexión.
 *
 * public/sw.js repite la lista (OFFLINE_PRODUCTS, sin build) y
 * tests/unit/offline-apps.test.ts compara las dos. Sin red, el selector de
 * apps marca las demás como "Necesita conexión" y el worker responde a sus
 * pantallas con una página que lo explica y lleva a las que sí andan.
 */
import { PRODUCT_CONFIG, type ProductKey } from './products';

/** Apps con modo sin conexión, en el orden en que la página "necesita conexión" las ofrece. */
export const OFFLINE_PRODUCTS = ['docs', 'notes', 'track', 'crm', 'board', 'cal'] as const satisfies readonly ProductKey[];

export function worksOffline(key: ProductKey | string | null | undefined): boolean {
  return (OFFLINE_PRODUCTS as readonly string[]).includes(String(key));
}

/** Rutas de inicio de cada app sin conexión (sin locale): se guardan para abrirlas sin red. */
export function offlineRoots(locale: string): string[] {
  return [`/${locale}/app`, ...OFFLINE_PRODUCTS.map((k) => `/${locale}${PRODUCT_CONFIG[k].launch}`)];
}

/** Cada cuánto se vuelven a guardar los inicios de las apps sin conexión (con red). */
export const OFFLINE_ROOTS_EVERY_MS = 6 * 60 * 60 * 1000;

type KV = Pick<Storage, 'getItem' | 'setItem'>;

/** localStorage, o null si el navegador no lo deja usar. */
export function safeStorage(): KV | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Inicios de las apps sin conexión que toca volver a guardar (como mucho cada
 * 6 horas por persona y dispositivo); anota la hora. En un navegador
 * automatizado (`bot`) solo si el test lo pide con zs-e2e-warm-roots.
 */
export function rootsDue(storage: KV | null, owner: string, locale: string, origin: string, now: number, bot = false): string[] {
  if (!storage || !owner) return [];
  try {
    if (bot && storage.getItem('zs-e2e-warm-roots') !== '1') return [];
    const key = `zs-offline-roots-at:${owner}`;
    const last = Number(storage.getItem(key)) || 0;
    if (last && now - last < OFFLINE_ROOTS_EVERY_MS) return [];
    storage.setItem(key, String(now));
    return offlineRoots(locale).map((p) => new URL(p, origin).href);
  } catch {
    return [];
  }
}
