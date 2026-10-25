import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import MinimalProductSettings from '@/components/app/ProductSettingsShell';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.products' });
  return { title: t('title', { app: 'Flow' }) };
}

/** Ajustes de Flow: por ahora atajos (credenciales, tablas, API y webhooks). */
export default async function FlowSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return <MinimalProductSettings locale={locale} product="flow" />;
}
