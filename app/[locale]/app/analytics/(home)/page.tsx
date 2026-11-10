import { getTranslations, setRequestLocale } from 'next-intl/server';
import BiHome from '@/components/bi/BiHome';
import { biPage } from '@/lib/bi/page';
import { listCollections, listItems, personalCollection } from '@/lib/bi/store';
import { biAiAvailable } from '@/lib/bi/ai';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'bi.home' });
  return { title: t('title') };
}

/** Inicio de Analytics: colecciones, preguntas y tableros, y la caja para preguntar. */
export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { viewer } = await biPage(locale);
  const t = await getTranslations({ locale, namespace: 'bi.home' });
  await personalCollection(viewer, t('myCollection'));
  const [items, collections, ai] = await Promise.all([listItems(viewer), listCollections(viewer), biAiAvailable()]);
  return <BiHome initialItems={items} initialCollections={collections} aiAvailable={ai} />;
}
