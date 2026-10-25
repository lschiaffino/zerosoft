import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import MinimalProductSettings from '@/components/app/ProductSettingsShell';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.products' });
  return { title: t('title', { app: 'Notes' }) };
}

/** Ajustes de Notes: por ahora atajos (importar de Evernote, recortes web). */
export default async function NotesSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return <MinimalProductSettings locale={locale} product="notes" />;
}
