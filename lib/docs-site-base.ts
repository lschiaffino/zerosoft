import { headers } from 'next/headers';

/**
 * Base de los links del sitio publicado. En el dominio propio (el middleware
 * reescribe docs.empresa.com/<slug> → /<locale>/h/<handle>/<slug> y marca el
 * pedido con este header, que nunca acepta de afuera) los links van a la raíz
 * del dominio; en la app, a /<locale>/h/<handle>.
 */
import { DOCS_SITE_HEADER } from './docs-site-header';

export { DOCS_SITE_HEADER };

export async function siteRequest(handle: string): Promise<{ onDomain: boolean; host: string | null }> {
  const h = await headers();
  const onDomain = h.get(DOCS_SITE_HEADER) === handle.toLowerCase();
  return { onDomain, host: onDomain ? h.get('host') : null };
}

export async function helpBase(locale: string, handle: string): Promise<string> {
  const { onDomain } = await siteRequest(handle);
  return onDomain ? '' : `/${locale}/h/${handle}`;
}

/** Origen de la app (para links a /app desde un dominio propio: la sesión vive ahí). */
export function appOrigin(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}
