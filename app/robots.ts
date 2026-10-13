import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/tools/registry';

/** robots.txt: el sitio público se indexa; la app y la API no. */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [{ userAgent: '*', allow: ['/', '/api/og/'], disallow: ['/api/', '/en/app', '/es/app', '/pt/app'] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
