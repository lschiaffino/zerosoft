import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { ProductSettingsShell } from '@/components/app/ProductSettingsShell';
import RecSettings from '@/components/rec/RecSettings';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.products' });
  return { title: t('title', { app: 'Rec' }) };
}

/** Ajustes de Rec: defaults de los videos nuevos, marca, retención y traspaso. */
export default async function RecSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'settings.products' });
  return (
    <ProductSettingsShell locale={locale} product="rec" tabs={[{ key: 'general', label: t('general') }]}>
      <RecSettings />
    </ProductSettingsShell>
  );
}
