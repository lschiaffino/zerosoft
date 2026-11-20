import { DIRECTORY_REVIEWED, SOFTWARE_DIRECTORY, licenseUrl, type DirectoryCategory, type DirectoryProduct } from '@/content/software-directory';
import { loc } from '@/lib/feature-parity';
import { PRODUCT_CONFIG, productHref } from '@/lib/products';
import { absoluteUrl, localePath, softwareLd } from '@/lib/seo';

/**
 * Directorio de software (/software y /software/<categoría>). Los datos están
 * en content/software-directory.ts; acá los textos que se arman con ellos y el
 * JSON-LD, compartidos por las páginas, el sitemap y llms.txt.
 */

export { DIRECTORY_REVIEWED, SOFTWARE_DIRECTORY, directoryCategory } from '@/content/software-directory';
export type { DirectoryCategory, DirectoryProduct } from '@/content/software-directory';

export const DIRECTORY_PATH = '/software';

export function categoryPath(slug: string): string {
  return `${DIRECTORY_PATH}/${slug}`;
}

/** "HubSpot, Salesforce y Pipedrive" en el idioma de la página. */
export function listText(items: string[], locale: string): string {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);
}

/** Variables de los textos de una categoría (título, descripción, primera oración). */
export function categoryVars(c: DirectoryCategory, locale: string) {
  return {
    name: loc(c.name, locale),
    title: loc(c.title, locale),
    apps: listText(
      c.apps.map((k) => PRODUCT_CONFIG[k].name),
      locale,
    ),
    count: c.apps.length,
    /** El pago más conocido, para el título. */
    paid: c.paid[0].name,
    /** Los dos primeros pagos, para la primera oración. */
    paidTwo: listText(
      c.paid.slice(0, 2).map((p) => p.name),
      locale,
    ),
    openNames: listText(
      c.openSource.slice(0, 3).map((p) => p.name),
      locale,
    ),
    paidNames: listText(
      c.paid.slice(0, 3).map((p) => p.name),
      locale,
    ),
  };
}

function thirdPartyLd(p: DirectoryProduct) {
  const license = p.license ? licenseUrl(p.license) : null;
  return {
    '@type': 'SoftwareApplication',
    name: p.name,
    url: p.url,
    applicationCategory: 'BusinessApplication',
    ...(license ? { license } : {}),
    ...(p.source ? { sameAs: p.source } : {}),
  };
}

/**
 * JSON-LD de una categoría: la página como CollectionPage con un ItemList de
 * todo lo que lista (primero las apps de zerosoft, que van completas como
 * SoftwareApplication), y las apps de zerosoft con su oferta real.
 */
export function categoryLd(c: DirectoryCategory, locale: string, text: { title: string; description: string; appDescriptions: Record<string, string> }) {
  const apps = c.apps.map((k) =>
    softwareLd({
      locale,
      name: `zerosoft ${PRODUCT_CONFIG[k].name}`,
      description: text.appDescriptions[k] ?? '',
      path: productHref(k),
      image: `/api/og/product/${k}/${locale}`,
    }),
  );
  const items = [...apps.map((a) => ({ '@id': a['@id'] })), ...c.openSource.map(thirdPartyLd), ...(c.sourceAvailable ?? []).map(thirdPartyLd), ...c.paid.map(thirdPartyLd)];
  const page = {
    '@type': 'CollectionPage',
    name: text.title,
    description: text.description,
    url: absoluteUrl(localePath(locale, categoryPath(c.slug))),
    inLanguage: locale,
    dateModified: DIRECTORY_REVIEWED,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: items.length,
      itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, item })),
    },
  };
  return [page, ...apps];
}

/** Todas las rutas /software/<slug>. */
export function categorySlugs(): string[] {
  return SOFTWARE_DIRECTORY.map((c) => c.slug);
}
