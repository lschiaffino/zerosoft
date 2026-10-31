import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { libraryData } from '@/lib/rec-app';
import RecLibrary from '@/components/rec/RecLibrary';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'rec.library' });
  return { title: `${t('archive')} · Rec` };
}

/** Rec: lo archivado. Los links siguen andando. */
export default async function RecPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const data = await libraryData(locale, { kind: 'archived' });
  return <RecLibrary scope={{ kind: 'archived' }} initialVideos={data!.videos} initialFolders={data!.folders} initialSpaces={data!.spaces} baseUrl={data!.baseUrl} />;
}
