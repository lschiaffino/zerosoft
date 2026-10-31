import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { libraryData } from '@/lib/rec-app';
import RecLibrary from '@/components/rec/RecLibrary';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'rec' });
  return { title: t('meta.title') };
}

/** Rec: Mis videos (lo que grabé, fuera de carpetas). ?new=1 (menú "+ Nuevo") abre el grabador. */
export default async function RecPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ new?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  if (sp.new === '1') redirect(`/${locale}/app/rec/new`);
  const data = await libraryData(locale, { kind: 'mine' });
  return <RecLibrary scope={{ kind: 'mine' }} initialVideos={data!.videos} initialFolders={data!.folders} baseUrl={data!.baseUrl} />;
}
