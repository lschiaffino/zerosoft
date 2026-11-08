/**
 * Precarga por intención (components/app/IntentPrefetch.tsx): al dejar el
 * puntero sobre un link de navegación de la app (sidebar, apps del inicio)
 * se pide la página entera, y el clic que viene muestra lo precargado sin
 * esperar al servidor. Sin lógica de React: lo prueba tests/unit.
 */

/** Cuánto tiene que quedarse el puntero sobre el link (pasar de largo no precarga). */
export const INTENT_DWELL_MS = 70;
/** Una precarga sirve este tiempo (= experimental.staleTimes.static en next.config.mjs). */
export const INTENT_FRESH_MS = 30_000;
/**
 * Si al llegar la precarga ya tenía más que esto, se refresca la página en
 * segundo plano: se ve al instante y en seguida con los datos de ahora.
 */
export const INTENT_REFRESH_AFTER_MS = 5_000;

/** Contenedores cuyos links se precargan: navegación, no listas de datos. */
export const INTENT_SELECTOR = '#app-side a[href], .app-home-apps a[href], a.home-more-app[href]';

/**
 * Path a precargar para un link, o null si no corresponde: otro origen,
 * otra pestaña, descarga, una API, fuera de la app o la página actual.
 */
export function intentTarget(
  link: { href: string; target?: string; hasDownload?: boolean },
  current: { origin: string; pathname: string; search: string },
): string | null {
  if (link.target && link.target !== '_self') return null;
  if (link.hasDownload) return null;
  let url: URL;
  try {
    url = new URL(link.href, current.origin);
  } catch {
    return null;
  }
  if (url.origin !== current.origin) return null;
  if (!/^\/(en|es|pt)\/app(\/|$)/.test(url.pathname)) return null;
  if (url.pathname === current.pathname && url.search === current.search) return null;
  return `${url.pathname}${url.search}`;
}

/** ¿Hace falta pedirla de nuevo? (nunca pedida, o la anterior ya venció). */
export function needsPrefetch(lastAt: number | undefined, now: number): boolean {
  return lastAt === undefined || now - lastAt >= INTENT_FRESH_MS;
}
