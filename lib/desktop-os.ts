/**
 * Para qué sistema ofrecer la app de escritorio y adónde lleva cada botón de
 * descarga. Se usa en el cliente (header, home, tarjeta del inicio de la app)
 * y en el servidor (la ruta que cuenta los clics). Sin dependencias de Node.
 *
 * Todos los botones pasan por /api/desktop/download?from=<lugar>&os=<sistema>:
 * ahí se cuenta el clic (download_click en Pulse, por lugar) y se redirige a
 * /download/start (que baja el instalador y muestra cómo instalarlo) o, sin
 * sistema, a /download.
 */

export const DESKTOP_OSES = ['mac-arm', 'mac-intel', 'win'] as const;
export type DesktopOs = (typeof DESKTOP_OSES)[number];

/** Dónde estaba el botón. Lo que no está en la lista se cuenta como "other". */
export const DOWNLOAD_PLACEMENTS = ['header', 'footer', 'home', 'product', 'download', 'onboarding', 'in-app', 'menu', 'email'] as const;
export type DownloadPlacement = (typeof DOWNLOAD_PLACEMENTS)[number];

export function isDesktopOs(v: unknown): v is DesktopOs {
  return typeof v === 'string' && (DESKTOP_OSES as readonly string[]).includes(v);
}

export function asPlacement(v: unknown): DownloadPlacement | 'other' {
  return typeof v === 'string' && (DOWNLOAD_PLACEMENTS as readonly string[]).includes(v) ? (v as DownloadPlacement) : 'other';
}

/**
 * El sistema por el user agent. "mobile" incluye el iPad (que se presenta
 * como Mac pero tiene pantalla táctil); "other" es Linux, ChromeOS y el resto,
 * donde todavía no hay app. En Mac el chip no sale del user agent: se asume
 * Apple silicon y detectDesktopOs lo corrige cuando el navegador lo dice.
 */
export function osFromUserAgent(ua: string, maxTouchPoints = 0): DesktopOs | 'mobile' | 'other' {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return 'mobile';
  if (/Windows NT/i.test(ua)) return 'win';
  if (/Macintosh|Mac OS X/i.test(ua)) return maxTouchPoints > 1 ? 'mobile' : 'mac-arm';
  return 'other';
}

/**
 * El sistema de quien mira, con el chip del Mac si el navegador lo expone
 * (Chrome, userAgentData). Safari y Firefox no lo dicen: Apple silicon, con
 * el link a Intel en la página de descarga.
 */
export async function detectDesktopOs(): Promise<DesktopOs | 'mobile' | 'other'> {
  const base = osFromUserAgent(navigator.userAgent, navigator.maxTouchPoints);
  if (base !== 'mac-arm') return base;
  const uad = (navigator as Navigator & { userAgentData?: { getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string }> } }).userAgentData;
  try {
    const v = await uad?.getHighEntropyValues?.(['architecture']);
    if (v?.architecture === 'x86') return 'mac-intel';
  } catch {
    /* sin datos: Apple silicon */
  }
  return 'mac-arm';
}

/** Dentro de la app de escritorio (existe el puente de lib/desktop-bridge.ts). */
export function inDesktopShell(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as unknown as { zerosoftDesktop?: unknown }).zerosoftDesktop);
}

/** Link de un botón de descarga: cuenta el clic y lleva al instalador o a /download. */
export function downloadHref(from: DownloadPlacement, opts: { os?: DesktopOs | null; locale?: string | null } = {}): string {
  const q = new URLSearchParams({ from });
  if (opts.os) q.set('os', opts.os);
  if (opts.locale) q.set('locale', opts.locale);
  return `/api/desktop/download?${q.toString()}`;
}
