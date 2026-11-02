import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { pageMetadata } from '@/lib/seo';
import { STATIC_PAGES, type StaticPage, type StaticPageKey } from '@/lib/seo-routes';

export { STATIC_PAGES, isStaticPageKey, type StaticPage, type StaticPageKey } from '@/lib/seo-routes';

/* Metadata de las páginas fijas (el registro está en lib/seo-routes.ts). */

/** Título y descripción de una página fija en un idioma. */
export async function staticPageText(key: StaticPageKey, locale: string): Promise<{ title: string; description: string }> {
  const page: StaticPage = STATIC_PAGES[key];
  const t = await getTranslations({ locale, namespace: page.ns as never });
  return { title: t(page.title as never), description: t(page.description as never) };
}

/** Imagen OG de una página fija (el home usa la de la marca). */
export function staticPageImage(key: StaticPageKey, locale: string): string {
  return key === 'home' ? '/api/og/home' : `/api/og/page/${locale}/${key}`;
}

/** generateMetadata de una página fija. `extra` suma campos (feeds del changelog, etc.). */
export async function staticPageMetadata(key: StaticPageKey, locale: string, extra?: Partial<Metadata>): Promise<Metadata> {
  const { title, description } = await staticPageText(key, locale);
  const meta = pageMetadata({
    locale,
    path: STATIC_PAGES[key].path,
    title,
    description,
    image: staticPageImage(key, locale),
    absoluteTitle: key === 'home',
  });
  if (!extra) return meta;
  return {
    ...meta,
    ...extra,
    alternates: { ...meta.alternates, ...(extra.alternates ?? {}) },
  };
}
