import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { siteUrl } from '@/lib/tools/registry';
import { isAppHost } from '@/lib/hosts';
import { getDocsSite, siteForHost } from '@/lib/docs-site';

/**
 * robots.txt: el sitio público se indexa; la app y la API no. En el dominio
 * propio de un sitio de Docs, el de ese sitio (con "Indexar en buscadores"
 * apagado no se indexa nada).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get('host');
  if (host && !isAppHost(host)) {
    const site = await siteForHost(host);
    const indexing = site ? (await getDocsSite(site.workspaceId)).indexing : false;
    return {
      rules: [indexing ? { userAgent: '*', allow: '/', disallow: ['/api/'] } : { userAgent: '*', disallow: '/' }],
      ...(indexing ? { sitemap: `https://${host.toLowerCase()}/sitemap.xml` } : {}),
    };
  }
  const base = siteUrl();
  return {
    rules: [{ userAgent: '*', allow: ['/', '/api/og/'], disallow: ['/api/', '/en/app', '/es/app', '/pt/app'] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
