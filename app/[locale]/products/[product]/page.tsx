import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ProductPage from '@/components/products/ProductPage';
import { pageMetadata } from '@/lib/seo';
import { PRODUCT_KEYS, productHref, productKeyFromSlug, productSlug } from '@/lib/products';
import '@/styles/pages.css';

export async function generateMetadata(props: { params: Promise<{ locale: string; product: string }> }) {
  const { locale, product: slug } = await props.params;
  const product = productKeyFromSlug(slug);
  if (!product) return {};
  const t = await getTranslations({ locale, namespace: `pages.products.${product}.meta` });
  return pageMetadata({
    locale,
    path: productHref(product),
    title: t('title'),
    description: t('description'),
    image: `/api/og/product/${product}/${locale}`,
  });
}

// Solo los de generateStaticParams: otro valor es un 404 sin caché (con dynamicParams el CDN
// guardaba cada 404 inventado por un año).
export const dynamicParams = false;

export function generateStaticParams() {
  return PRODUCT_KEYS.map((key) => ({ product: productSlug(key) }));
}

export default async function Page(
  props: {
    params: Promise<{ locale: string; product: string }>;
  }
) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  const product = productKeyFromSlug(params.product);
  if (!product) notFound();
  return <ProductPage locale={locale} product={product} />;
}
