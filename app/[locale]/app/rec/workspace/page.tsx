import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { libraryData } from '@/lib/rec-app';
import RecLibrary from '@/components/rec/RecLibrary';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'rec.library' });
  return { title: `${t('workspace')} · Rec` };
}

/** Rec: el espacio compartido con todo el workspace. */
export default async function RecWorkspacePage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const data = await libraryData(locale, { kind: 'workspace' });
  return <RecLibrary scope={{ kind: 'workspace' }} initialVideos={data!.videos} initialFolders={data!.folders} baseUrl={data!.baseUrl} />;
}
