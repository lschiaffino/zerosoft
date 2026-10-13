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
  return new Set(hosts);
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
