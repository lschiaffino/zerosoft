import { getTranslations, setRequestLocale } from 'next-intl/server';
import DataSources from '@/components/bi/DataSources';
import { biPage } from '@/lib/bi/page';
import { listDatabases } from '@/lib/bi/store';
import { zsSchema } from '@/lib/bi/zs-tables';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'bi.data' });
  return { title: `${t('title')} · Analytics` };
}

/** Datos: tablas propias del workspace y bases externas conectadas. */
export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { viewer, isAdmin } = await biPage(locale);
  const [databases, zs] = await Promise.all([listDatabases(viewer), zsSchema(viewer)]);
  return <DataSources initialDatabases={databases} zsTables={zs} isAdmin={isAdmin} />;
}
