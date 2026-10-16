/**
 * Subdominios de superficie: feedback.<dominio> sirve el board público y
 * branding.<dominio> la página de marca. El middleware reescribe / y /<path> a
 * /<locale>/<prefijo>/<path>. Sin DB ni imports de Node: lo usa el middleware.
 *
 * - FEEDBACK_HOST (default feedback.zerosoft.ai) → /<locale>/feedback-board
 * - BRANDING_HOST (default branding.zerosoft.ai) → /<locale>/brand
 * Ambas aceptan una lista separada por coma. En desarrollo también responden
 * feedback.localhost y branding.localhost.
 */

export type HostSurface = 'board' | 'brand';

export const SURFACE_PREFIX: Record<HostSurface, string> = {
  board: 'feedback-board',
  brand: 'brand',
};

const LOCALES = ['en', 'es', 'pt'] as const;

function bareHost(value: string | null | undefined): string {
  let v = (value ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (v.includes('://')) {
    try {
      v = new URL(v).host;
    } catch {
      return '';
    }
  }
  return v.replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
}

function hostList(env: string | undefined, fallback: string): string[] {
  const list = (env ?? '')
    .split(',')
    .map((h) => bareHost(h))
    .filter(Boolean);
  return list.length > 0 ? list : [fallback];
}

export function feedbackHosts(): string[] {
  return hostList(process.env.FEEDBACK_HOST, 'feedback.zerosoft.ai');
}

export function brandingHosts(): string[] {
  return hostList(process.env.BRANDING_HOST, 'branding.zerosoft.ai');
}

/** Host principal del board (el primero de FEEDBACK_HOST). */
export function primaryFeedbackHost(): string {
  return feedbackHosts()[0];
}

/** ¿Qué superficie sirve este host? null = el sitio/app normal (o un dominio de Link). */
export function surfaceForHost(rawHost: string | null | undefined): HostSurface | null {
  const host = bareHost(rawHost);
  if (!host) return null;
  if (host === 'feedback.localhost' || feedbackHosts().includes(host)) return 'board';
  if (host === 'branding.localhost' || brandingHosts().includes(host)) return 'brand';
  return null;
}

/**
 * Path interno para un path pedido en un host de superficie.
 * /            → /<locale>/<prefijo>
 * /i/abc       → /<locale>/<prefijo>/i/abc
 * /es/i/abc    → /es/<prefijo>/i/abc      (el locale del path manda)
 * /es/<prefijo>/x → sin cambios (links que ya traen el prefijo)
 */
export function surfaceRewritePath(
  surface: HostSurface,
  pathname: string,
  fallbackLocale: string,
): { path: string; locale: string } {
  const prefix = `/${SURFACE_PREFIX[surface]}`;
  const m = /^\/(en|es|pt)(?=\/|$)(.*)$/.exec(pathname);
  const locale = m ? m[1] : (LOCALES as readonly string[]).includes(fallbackLocale) ? fallbackLocale : 'en';
  let rest = m ? m[2] : pathname;
  if (rest === '/' || rest === '') rest = '';
  if (rest === prefix || rest.startsWith(`${prefix}/`)) return { path: `/${locale}${rest}`, locale };
  return { path: `/${locale}${prefix}${rest}`, locale };
}
