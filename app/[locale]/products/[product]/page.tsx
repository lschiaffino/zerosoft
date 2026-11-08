import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ProductPage from '@/components/products/ProductPage';
import { pageMetadata } from '@/lib/seo';
import { PRODUCT_KEYS, isProductKey } from '@/lib/products';
import '@/styles/pages.css';

export async function generateMetadata(props: { params: Promise<{ locale: string; product: string }> }) {
  const { locale, product } = await props.params;
  if (!isProductKey(product)) return {};
  const t = await getTranslations({ locale, namespace: `pages.products.${product}.meta` });
  return pageMetadata({
    locale,
    path: `/products/${product}`,
    title: t('title'),
    description: t('description'),
    image: `/api/og/product/${product}/${locale}`,
  });
}

// Solo los de generateStaticParams: otro valor es un 404 sin caché (con dynamicParams el CDN
// guardaba cada 404 inventado por un año).
export const dynamicParams = false;

export function generateStaticParams() {
  return PRODUCT_KEYS.map((product) => ({ product }));
}

export default async function Page(
  props: {
    params: Promise<{ locale: string; product: string }>;
  }
) {
  const params = await props.params;

  const {
    locale,
    product
  } = params;

  setRequestLocale(locale);
  if (!isProductKey(product)) notFound();
  return <ProductPage locale={locale} product={product} />;
}
