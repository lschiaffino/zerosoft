import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { isAppHost } from '@/lib/hosts';
import { siteForHost, siteSitemap } from '@/lib/docs-site';
import { sitemapEntries } from '@/lib/sitemap-entries';

/**
 * sitemap.xml del sitio público: cada página en los idiomas en que existe,
 * con hreflang y x-default (lib/sitemap-entries.ts). En el dominio propio de
 * un sitio de Docs, las páginas publicadas de ese sitio.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host');
  if (host && !isAppHost(host)) {
    const site = await siteForHost(host);
    return site ? siteSitemap(site.workspaceId, `https://${host.toLowerCase()}`) : [];
  }
  return sitemapEntries();
}
