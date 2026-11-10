import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { homeOgImage, pageMetadata } from '@/lib/seo';
import { STATIC_PAGES, type StaticPage, type StaticPageKey } from '@/lib/seo-routes';

export { STATIC_PAGES, isStaticPageKey, type StaticPage, type StaticPageKey } from '@/lib/seo-routes';

/* Metadata de las páginas fijas (el registro está en lib/seo-routes.ts). */

/** Título y descripción de una página fija en un idioma. */
export async function staticPageText(key: StaticPageKey, locale: string): Promise<{ title: string; description: string }> {
  const page: StaticPage = STATIC_PAGES[key];
  const t = await getTranslations({ locale, namespace: page.ns as never });
  return { title: t(page.title as never), description: t(page.description as never) };
}

/** Tarjeta para compartir de una página fija (home, changelog y herramientas tienen la suya). */
export function staticPageImage(key: StaticPageKey, locale: string): string {
  if (key === 'home') return homeOgImage(locale);
  if (key === 'changelog') return `/api/og/changelog/${locale}`;
  if (key === 'tools') return `/api/og/tool/hub/${locale}`;
  return `/api/og/page/${locale}/${key}`;
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
