import { brandingHosts, feedbackHosts } from './host-rewrite';

/**
 * ¿Este host es la app (zerosoft.ai, previews, localhost) o un dominio propio
 * de Link? Sin DB ni imports de Node: lo usa el middleware.
 */

function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).host.toLowerCase();
  } catch {
    return null;
  }
}

export function appHosts(): Set<string> {
  const hosts = [
    process.env.NEXTAUTH_URL,
    process.env.SHORT_DOMAIN,
    process.env.APP_HOSTS,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]
    .flatMap((v) => (v ?? '').split(','))
    .map((v) => hostOf(v.trim()))
    .filter((h): h is string => Boolean(h));
  // Subdominios de superficie (board público, marca): son la app, no dominios de Link.
  for (const h of [...feedbackHosts(), ...brandingHosts()]) hosts.push(h);
  return new Set(hosts);
}

/**
 * ¿Es otra URL de deployment de este mismo proyecto de Vercel
 * (<proyecto>-<hash>-<scope>.vercel.app o <proyecto>-git-<rama>-<scope>.vercel.app)?
 * Sirven los mismos links con la misma DB. Se deriva de VERCEL_URL para no
 * tratar como propio cualquier *.vercel.app de terceros.
 */
export function isOwnDeploymentHost(rawHost: string | null | undefined): boolean {
  const bare = normalizeHost(rawHost).replace(/:\d+$/, '');
  if (!bare.endsWith('.vercel.app')) return false;
  const label = bare.slice(0, -'.vercel.app'.length);
  const own = hostOf(process.env.VERCEL_URL)?.replace(/\.vercel\.app$/, '');
  const m = own ? /^(.+?)-[a-z0-9]{8,10}-([a-z0-9-]+)$/.exec(own) : null;
  if (!m) return false;
  const [, project, scope] = m;
  return label === project || (label.startsWith(`${project}-`) && label.endsWith(`-${scope}`));
}

export function normalizeHost(host: string | null | undefined): string {
  return (host ?? '').toLowerCase().replace(/\.$/, '');
}

export function isAppHost(rawHost: string | null | undefined): boolean {
  const host = normalizeHost(rawHost);
  if (!host) return true;
  const bare = host.replace(/:\d+$/, '');
  if (bare === 'localhost' || bare === '127.0.0.1' || bare.endsWith('.localhost')) return true;
  if (bare.endsWith('.vercel.app')) return true;
  const app = appHosts();
  return app.has(host) || app.has(bare) || app.has(`www.${bare}`) || (bare.startsWith('www.') && app.has(bare.slice(4)));
}

/** Hostname válido para un dominio propio (sin puerto, sin path). */
export function isValidHostname(host: string): boolean {
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
}

/**
 * ¿Se puede volver a esta URL después del login? Solo el mismo origen, los
 * hosts de la app (incluidos los subdominios de superficie) y deployments
 * propios. Nunca un dominio de Link de un cliente ni un *.vercel.app ajeno.
 */
export function isTrustedReturnUrl(url: string, baseUrl: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (u.origin === new URL(baseUrl).origin) return true;
    const host = normalizeHost(u.host);
    const bare = host.replace(/:\d+$/, '');
    if (bare === 'localhost' || bare.endsWith('.localhost') || bare === '127.0.0.1') {
      return process.env.NODE_ENV !== 'production';
    }
    return appHosts().has(host) || appHosts().has(bare) || isOwnDeploymentHost(host);
  } catch {
    return false;
  }
}

/**
 * callbackUrl seguro para /auth/signin: un path relativo del sitio o una URL
 * absoluta de confianza (isTrustedReturnUrl). Si no, null.
 */
export function safeCallbackUrl(raw: string | null | undefined, baseUrl: string): string | null {
  if (!raw || raw.length > 1000) return null;
  if (raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')) return raw;
  return isTrustedReturnUrl(raw, baseUrl) ? raw : null;
}
