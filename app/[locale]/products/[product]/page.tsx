import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ProductPage from '@/components/products/ProductPage';
import { PRODUCT_KEYS, isProductKey } from '@/lib/products';
import '@/styles/pages.css';

export async function generateMetadata({
  params: { locale, product },
}: {
  params: { locale: string; product: string };
}) {
  if (!isProductKey(product)) return {};
  const t = await getTranslations({ locale, namespace: `pages.products.${product}.meta` });
  const title = t('title');
  const description = t('description');
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      url: `/${locale}/products/${product}`,
      images: [`/api/og/product/${product}`],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`/api/og/product/${product}`],
    },
  };
}

export function generateStaticParams() {
  return PRODUCT_KEYS.map((product) => ({ product }));
}

export default async function Page({
  params: { locale, product },
}: {
  params: { locale: string; product: string };
}) {
  setRequestLocale(locale);
  if (!isProductKey(product)) notFound();
  return <ProductPage locale={locale} product={product} />;
}
