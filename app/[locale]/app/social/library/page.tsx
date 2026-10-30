import { getTranslations } from 'next-intl/server';
import PageHeader from '@/components/ui/PageHeader';
import LibraryView from '@/components/social/LibraryView';
import { requireUser } from '@/lib/session';
import { listLibrary, socialActor, type LibraryKind } from '@/lib/social';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: t('library.title') };
}

/** Biblioteca: textos guardados, grupos de hashtags y archivos del workspace. */
export default async function SocialLibraryPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ kind?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  const kind = sp.kind === 'snippet' || sp.kind === 'hashtags' || sp.kind === 'asset' ? (sp.kind as LibraryKind) : 'all';
  const items = await listLibrary(socialActor(user));
  return (
    <div className="ui-page">
      <PageHeader title={t('library.title')} description={t('library.description')} />
      <LibraryView items={items} kind={kind} />
    </div>
  );
}
