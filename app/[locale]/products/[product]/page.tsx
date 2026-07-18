import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ProductPage, {
  PRODUCT_KEYS,
  type ProductKey,
} from '@/components/products/ProductPage';
import '@/styles/pages.css';

function isProduct(value: string): value is ProductKey {
  return (PRODUCT_KEYS as string[]).includes(value);
}

export async function generateMetadata({
  params: { locale, product },
}: {
  params: { locale: string; product: string };
}) {
  if (!isProduct(product)) return {};
  const t = await getTranslations({ locale, namespace: `pages.products.${product}.meta` });
  return { title: t('title'), description: t('description') };
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
  if (!isProduct(product)) notFound();
  return <ProductPage locale={locale} product={product} />;
}
